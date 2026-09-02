import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentAdapter, Category } from "../adapters/types.js";
import { parseManifest, type Manifest, type Component, effectiveSource, PACKAGES } from "../manifest.js";
import { resolveSource } from "../resolvers/file.js";
import { LSHED_DIR } from "../state.js";
import { DEFAULT_IGNORE } from "../ignore.js";

export interface Ctx {
  adapter: AgentAdapter;
  shed: string;
  log: (line: string) => void;
  /** 창고에 담지 않을 이름들. loadManifest 가 매니페스트 값으로 채운다. */
  ignore?: readonly string[];
}

export const MANIFEST_FILE = "lshed.yaml";
export const INSTRUCTIONS = "instructions";
/** 프로필이 지침을 가질 때 조각이 복사되는 곳 (어댑터 루트 기준) */
export const FRAGMENTS_DIR = `${LSHED_DIR}/instructions`;

export function manifestPath(ctx: Ctx): string {
  return path.join(ctx.shed, MANIFEST_FILE);
}

export function knownCategories(adapter: AgentAdapter): string[] {
  return [...adapter.categories().map((c) => c.name), INSTRUCTIONS];
}

export async function loadManifest(ctx: Ctx): Promise<Manifest> {
  let text: string;
  try {
    text = await fs.readFile(manifestPath(ctx), "utf8");
  } catch {
    throw new Error(`창고에 ${MANIFEST_FILE} 이 없습니다: ${ctx.shed}\n  먼저 'lshed init --shed ${ctx.shed}' 를 실행하세요.`);
  }
  const m = parseManifest(text, knownCategories(ctx.adapter));
  ctx.ignore = [...DEFAULT_IGNORE, ...(m.ignore ?? [])];
  return m;
}

export function ignoreOf(ctx: Ctx): readonly string[] {
  return ctx.ignore ?? DEFAULT_IGNORE;
}

/** 카테고리 하나의 부품이 로컬(어댑터 루트)에서 차지하는 상대 경로 */
export function targetRel(cat: Category | typeof INSTRUCTIONS, id: string): string {
  if (cat === INSTRUCTIONS) return `${FRAGMENTS_DIR}/${id}.md`;
  return cat.kind === "dir" ? `${cat.root}/${id}` : `${cat.root}/${id}.md`;
}

/** 부품의 창고 안 절대 경로 */
export function sourcePath(ctx: Ctx, category: string, c: Component): string {
  const cat = ctx.adapter.categories().find((k) => k.name === category);
  const kind = category === INSTRUCTIONS ? "file" : cat?.kind ?? "dir";
  return resolveSource(ctx.shed, effectiveSource(category, c, kind));
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
    const cat = category === INSTRUCTIONS ? INSTRUCTIONS : ctx.adapter.categories().find((k) => k.name === category);
    if (!cat) throw new Error(`프로필 "${profile}": 어댑터 ${ctx.adapter.name} 은 카테고리 "${category}" 를 모릅니다`);
    for (const id of ids) {
      const component = findComponent(m, category, id);
      items.push({ category, id, rel: targetRel(cat, id), src: sourcePath(ctx, category, component), component });
    }
  }
  return items;
}

export function abs(ctx: Ctx, rel: string): string {
  return path.join(ctx.adapter.root, ...rel.split("/"));
}
