import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Installer } from "../installers/types.js";
import { gitInstaller } from "../installers/git.js";
import { parseSource } from "../source.js";
import type { AgentAdapter, Category, EntryCategory } from "../adapters/types.js";
import { parseManifest, resolveProfile, packagesOf, type Manifest, type Component, type Package, effectiveSource, PACKAGES } from "../manifest.js";
import { resolveSource } from "../resolvers/file.js";
import { LSHED_DIR } from "../state.js";
import { DEFAULT_IGNORE } from "../ignore.js";
import YAML from "yaml";
import { createAdapter, adapterNames } from "../adapters/registry.js";

export interface Ctx {
  adapter: AgentAdapter;
  shed: string;
  log: (line: string) => void;
  /** 외부 명령 실행 (설치기용). 테스트에서 가짜로 바꾼다. 출력은 터미널로 흘린다. */
  exec: (cmd: string, args: string[], cwd?: string) => Promise<void>;
  /** 창고에 담지 않을 이름들. loadManifest 가 매니페스트 값으로 채운다. */
  ignore?: readonly string[];
}

/** 기본 exec: 자식 프로세스, stdio 상속. Windows 의 claude.cmd 같은 래퍼는 셸을 거쳐야 찾는다. */
export function spawnExec(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} 가 ${code} 로 끝났습니다`))));
  });
}

export function installersFor(ctx: Ctx): Installer[] {
  return [gitInstaller, ...ctx.adapter.installers()].sort((a, b) => a.priority - b.priority);
}

export function installerFor(ctx: Ctx, source: string): Installer {
  const s = parseSource(source);
  const scheme = s.scheme === "other" ? s.name : s.scheme;
  const inst = installersFor(ctx).find((i) => i.schemes.includes(scheme));
  if (!inst) throw new Error(`"${source}": 스킴 ${scheme} 을 다룰 설치기가 없습니다`);
  return inst;
}

export const MANIFEST_FILE = "lshed.yaml";
export const INSTRUCTIONS = "instructions";
/** 프로필이 지침을 가질 때 조각이 복사되는 곳 (어댑터 루트 기준) */
export const FRAGMENTS_DIR = `${LSHED_DIR}/instructions`;

export function manifestPath(ctx: Ctx): string {
  return path.join(ctx.shed, MANIFEST_FILE);
}

export function knownCategories(adapter: AgentAdapter): string[] {
  const instr = adapter.instructionsFileName() ? [INSTRUCTIONS] : [];
  return [...adapter.categories().map((c) => c.name), ...adapter.entries().map((e) => e.name), ...instr];
}

/** 매니페스트의 `agent:` 만 미리 읽는다. 검증은 그 에이전트 기준으로 해야 다른 에이전트로 restore 할 때도 열린다. */
export function manifestAgent(text: string): string | undefined {
  try {
    const raw = YAML.parse(text);
    return raw && typeof raw === "object" && typeof raw.agent === "string" ? raw.agent : undefined;
  } catch { return undefined; }
}

/**
 * 창고의 매니페스트. 카테고리·스킴 검증은 현재 어댑터가 아니라 **매니페스트가 만들어진 에이전트** 기준이다 (§4.6).
 * 창고 하나를 여러 에이전트가 공유하므로, 지금 어댑터가 모르는 카테고리는 오류가 아니라 restore 가 건너뛸 대상이다.
 */
export async function loadManifest(ctx: Ctx): Promise<Manifest> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath(ctx), "utf8");
  } catch {
    throw new Error(`창고에 ${MANIFEST_FILE} 이 없습니다: ${ctx.shed}\n  먼저 'lshed init --shed ${ctx.shed}' 를 실행하세요.`);
  }
  const agent = manifestAgent(text) ?? ctx.adapter.name;
  let origin: AgentAdapter = ctx.adapter;
  if (agent !== ctx.adapter.name) {
    if (!adapterNames().includes(agent)) throw new Error(`lshed.yaml 의 agent "${agent}" 를 모릅니다. 지원: ${adapterNames().join(", ")}`);
    origin = createAdapter(agent, ctx.adapter.root);
  }
  const schemes = [gitInstaller, ...origin.installers()].flatMap((i) => [...i.schemes]);
  const m = parseManifest(text, knownCategories(origin), schemes);
  ctx.ignore = [...DEFAULT_IGNORE, ...(m.ignore ?? [])];
  return m;
}

/** 스킴 이름 ("github", "claude-plugin", ...) */
export function schemeOf(source: string): string {
  const s = parseSource(source);
  return s.scheme === "other" ? s.name : s.scheme;
}

/**
 * 프로필의 패키지 중 현재 어댑터의 설치기가 다룰 수 있는 것과 없는 것 (§4.6).
 * Claude 플러그인은 Codex 로 설치할 수 없다 — 오류가 아니라 건너뛸 대상이다. restore/status/update 가 같은 기준을 쓴다.
 */
export function installablePackages(ctx: Ctx, m: Manifest, profile: string): { packages: Package[]; skipped: Package[] } {
  const schemes = new Set(installersFor(ctx).flatMap((i) => [...i.schemes]));
  const packages: Package[] = [], skipped: Package[] = [];
  for (const p of packagesOf(m, profile)) (schemes.has(schemeOf(p.source)) ? packages : skipped).push(p);
  return { packages, skipped };
}

/** 프로필이 쓰지만 현재 어댑터가 모르는 카테고리 (다른 에이전트의 창고를 restore 할 때 건너뛸 것) */
export function unsupportedCategories(ctx: Ctx, m: Manifest, profile: string): string[] {
  const known = new Set([...knownCategories(ctx.adapter), PACKAGES]);
  return Object.keys(resolveProfile(m, profile)).filter((c) => !known.has(c));
}

export function ignoreOf(ctx: Ctx): readonly string[] {
  return ctx.ignore ?? DEFAULT_IGNORE;
}

/**
 * 카테고리 하나의 부품이 로컬(어댑터 루트)에서 차지하는 상대 경로.
 * 항목형은 경로가 없으므로 "<category>:<id>" 로 적는다 (경로 구간에 ':' 은 못 오므로 구분된다).
 */
export function targetRel(cat: Category | EntryCategory | typeof INSTRUCTIONS, id: string): string {
  if (cat === INSTRUCTIONS) return `${FRAGMENTS_DIR}/${id}.md`;
  if (cat.kind === "entry") return `${cat.name}:${id}`;
  return cat.kind === "dir" ? `${cat.root}/${id}` : `${cat.root}/${id}.md`;
}

/** 관리 집합의 rel 이 항목형이면 그 카테고리와 id */
export function entryOf(ctx: Ctx, rel: string): { cat: EntryCategory; id: string } | undefined {
  const i = rel.indexOf(":");
  if (i <= 0) return undefined;
  const cat = ctx.adapter.entries().find((e) => e.name === rel.slice(0, i));
  return cat ? { cat, id: rel.slice(i + 1) } : undefined;
}

export function kindOf(ctx: Ctx, category: string): "dir" | "file" | "entry" {
  if (category === INSTRUCTIONS) return "file";
  if (ctx.adapter.entries().some((e) => e.name === category)) return "entry";
  return ctx.adapter.categories().find((k) => k.name === category)?.kind ?? "dir";
}

/** 부품의 창고 안 절대 경로 */
export function sourcePath(ctx: Ctx, category: string, c: Component): string {
  return resolveSource(ctx.shed, effectiveSource(category, c, kindOf(ctx, category)));
}

export function findComponent(m: Manifest, category: string, id: string): Component {
  const c = (m.components[category] ?? []).find((x) => x.id === id);
  if (!c) throw new Error(`${category}/${id} 는 components 에 없습니다`);
  return c;
}

/** 프로필 → 배치 항목 목록 */
export interface PlanItem {
  category: string;
  id: string;
  /** 어댑터 루트 기준 상대 경로 */
  rel: string;
  /** 창고 절대 경로 */
  src: string;
  component: Component;
  /** 항목형이면 그 카테고리 */
  entry?: EntryCategory;
}

export function planProfile(ctx: Ctx, m: Manifest, profile: string): PlanItem[] {
  const p = resolveProfile(m, profile);
  const items: PlanItem[] = [];
  const known = new Set(knownCategories(ctx.adapter));
  for (const [category, ids] of Object.entries(p)) {
    if (category === PACKAGES) continue;
    // 현재 어댑터가 모르는 카테고리는 계획에서 빠진다. 호출자가 unsupportedCategories 로 알린다.
    if (!known.has(category)) continue;
    const cat = category === INSTRUCTIONS ? INSTRUCTIONS
      : ctx.adapter.categories().find((k) => k.name === category) ?? ctx.adapter.entries().find((e) => e.name === category);
    if (!cat) continue;
    const entry = cat !== INSTRUCTIONS && cat.kind === "entry" ? cat : undefined;
    for (const id of ids) {
      const component = findComponent(m, category, id);
      items.push({ category, id, rel: targetRel(cat, id), src: sourcePath(ctx, category, component), component, entry });
    }
  }
  return items;
}

export function abs(ctx: Ctx, rel: string): string {
  return path.join(ctx.adapter.root, ...rel.split("/"));
}
