import path from "node:path";
import { isInside } from "../fsutil.js";
import type { Category, EntryCategory, ScannedComponent } from "../adapters/types.js";
import type { Ctx } from "./context.js";
import { detectPackages, detectGenerated, type DetectedPackage } from "./packages.js";
import type { Json } from "./entries.js";
import type { Manifest } from "../manifest.js";

/** 로컬에서 발견한 것 하나. init 과 add 가 같은 분류를 쓴다 (§3.7). */
export type Found =
  | { kind: "component"; category: string; id: string; path: string; cat: Category }
  | { kind: "entry"; category: string; id: string; value: Json; cat: EntryCategory; warn?: string }
  | { kind: "package"; category: "packages"; id: string; pkg: DetectedPackage };

export const keyOf = (f: { category: string; id: string }) => `${f.category}/${f.id}`;

/** 값 안의 모든 문자열. 경로처럼 보이는 것을 찾을 때 쓴다. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out);
  return out;
}

export interface Discovered {
  items: Found[];
  /** "category/id" → 만든 패키지 id. 담지 않는다 */
  generated: Map<string, string>;
  /** --exclude 로 뺀 키 */
  excluded: string[];
}

/**
 * 어댑터 루트를 훑어 세 종류로 가른다: 설치한 것(패키지) / 설치가 만들어낸 것(건너뜀) / 내가 쓴 것(부품·항목).
 * 로컬은 읽기만 한다.
 */
export async function discover(ctx: Ctx, exclude: readonly string[] = []): Promise<Discovered> {
  const isExcluded = (cat: string, id: string) => exclude.some((e) => e === id || e === `${cat}/${id}`);
  const excluded: string[] = [];
  const items: Found[] = [];

  const all = await ctx.adapter.scan();
  const pkgs = await detectPackages(ctx, all);
  const kept = pkgs.filter((p) => { if (isExcluded("packages", p.id)) { excluded.push(`packages/${p.id}`); return false; } return true; });
  const generated = await detectGenerated(all, kept);
  for (const p of kept) items.push({ kind: "package", category: "packages", id: p.id, pkg: p });

  for (const cat of ctx.adapter.categories()) {
    for (const f of all.filter((f) => f.category === cat.name)) {
      if (pkgs.some((p) => p.path === f.path) || generated.has(keyOf(f))) continue;
      if (isExcluded(f.category, f.id)) { excluded.push(keyOf(f)); continue; }
      items.push({ kind: "component", category: cat.name, id: f.id, path: f.path, cat });
    }
  }

  for (const cat of ctx.adapter.entries()) {
    const all = await cat.read();
    for (const id of Object.keys(all).sort()) {
      if (isExcluded(cat.name, id)) { excluded.push(`${cat.name}/${id}`); continue; }
      if (!/^[\w.-]+$/.test(id)) { ctx.log(`  ! ${cat.name}/${id}: 이름에 쓸 수 없는 문자가 있어 건너뜀`); continue; }
      // 값이 패키지 안을 가리키면 그 패키지의 설치가 써 넣은 것일 수 있다 (예: gstack 의 훅). 감지는 제안이다.
      // 문자열 포함이 아니라 경로로 견준다. JSON 안의 Windows 경로는 백슬래시가 이스케이프되어 있다.
      const owner = kept.find((p) => p.path && stringsIn(all[id]).some((s) => isInside(p.path!, s)));
      const warn = owner ? `패키지 ${owner.id} 안을 가리킵니다. 그 설치가 만든 것이면 exclude 하세요: ${cat.name}/${id}` : undefined;
      items.push({ kind: "entry", category: cat.name, id, value: all[id] as Json, cat, warn });
    }
  }
  return { items, generated, excluded };
}

/** 발견한 것 중 매니페스트에 아직 없는 것 (add 의 후보). */
export function notInManifest(m: Manifest, d: Discovered): Found[] {
  return d.items.filter((f) =>
    f.kind === "package" ? !m.packages.some((p) => p.id === f.id) : !(m.components[f.category] ?? []).some((c) => c.id === f.id),
  );
}

/** 매니페스트에는 있는데 이 프로필이 안 쓰는 것 중 로컬에 있는 것 (add 가 힌트로 보여준다). */
export function inManifestNotInProfile(m: Manifest, profile: string, d: Discovered): string[] {
  const p = m.profiles[profile] ?? {};
  return d.items
    .filter((f) => !notInManifest(m, d).includes(f))
    .filter((f) => !(p[f.category] ?? []).includes(f.id))
    .map(keyOf);
}

export function shortRev(rev: string): string {
  return /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev;
}

export const relOf = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");
