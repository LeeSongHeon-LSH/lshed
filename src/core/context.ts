import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Installer } from "../installers/types.js";
import { gitInstaller } from "../installers/git.js";
import { parseSource } from "../source.js";
import type { AgentAdapter, Category, EntryCategory } from "../adapters/types.js";
import { parseManifest, type Manifest, type Component, effectiveSource, PACKAGES } from "../manifest.js";
import { resolveSource } from "../resolvers/file.js";
import { LSHED_DIR } from "../state.js";
import { DEFAULT_IGNORE } from "../ignore.js";

export interface Ctx {
  adapter: AgentAdapter;
  shed: string;
  log: (line: string) => void;
  /** 외부 명령 실행 (설치기용). 테스트에서 가짜로 바꾼다. 출력은 터미널로 흘린다. */
  exec: (cmd: string, args: string[], cwd?: string) => Promise<void>;
  /** 창고에 담지 않을 이름들. loadManifest 가 매니페스트 값으로 채운다. */
  ignore?: readonly string[];
}

/** 기본 exec: 자식 프로세스, stdio 상속 */
export function spawnExec(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: "inherit" });
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
  return [...adapter.categories().map((c) => c.name), ...adapter.entries().map((e) => e.name), INSTRUCTIONS];
}

export async function loadManifest(ctx: Ctx): Promise<Manifest> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath(ctx), "utf8");
  } catch {
    throw new Error(`창고에 ${MANIFEST_FILE} 이 없습니다: ${ctx.shed}\n  먼저 'lshed init --shed ${ctx.shed}' 를 실행하세요.`);
  }
  const m = parseManifest(text, knownCategories(ctx.adapter), installersFor(ctx).flatMap((i) => [...i.schemes]));
  ctx.ignore = [...DEFAULT_IGNORE, ...(m.ignore ?? [])];
  return m;
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
  const p = m.profiles[profile];
  if (!p) {
    const names = Object.keys(m.profiles);
    throw new Error(`프로필 "${profile}" 이 없습니다. 있는 프로필: ${names.length ? names.join(", ") : "(없음)"}`);
  }
  const items: PlanItem[] = [];
  for (const [category, ids] of Object.entries(p)) {
    if (category === PACKAGES) continue;
    const cat = category === INSTRUCTIONS ? INSTRUCTIONS
      : ctx.adapter.categories().find((k) => k.name === category) ?? ctx.adapter.entries().find((e) => e.name === category);
    if (!cat) throw new Error(`프로필 "${profile}": 어댑터 ${ctx.adapter.name} 은 카테고리 "${category}" 를 모릅니다`);
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
