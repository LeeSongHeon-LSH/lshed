import { promises as fs } from "node:fs";
import path from "node:path";
import YAML, { isSeq, isMap } from "yaml";
import { type Ctx, manifestPath, loadManifest, sourcePath, findComponent } from "./context.js";
import { PACKAGES, parseKey, type Manifest } from "../manifest.js";
import { listRows } from "./list.js";
import { readLock, writeLock } from "../lock.js";
import { exists, removeTree } from "../fsutil.js";

/** "category/id" 또는 "id" → 유일한 항목으로 해석 */
export function resolveKey(m: Manifest, raw: string): { category: string; id: string } {
  const rows = listRows(m);
  const k = parseKey(raw);
  let hits = rows.filter((r) => r.id === k.id && (k.category === undefined || r.category === k.category));
  if (!hits.length && k.category !== undefined) hits = rows.filter((r) => r.id === raw); // "team/reviewer" 처럼 id 자체에 / 가 있는 경우
  if (!hits.length) throw new Error(`"${raw}" 는 창고에 없습니다`);
  if (hits.length > 1) throw new Error(`"${raw}" 가 모호합니다: ${hits.map((h) => `${h.category}/${h.id}`).join(", ")}`);
  return { category: hits[0].category, id: hits[0].id };
}

/**
 * 창고에서 부품/패키지를 뺀다 (§3.1 "창고에서 버리기").
 * 프로필이 참조하면 거부한다. 창고 파일은 지운다. 백업은 없다. 창고는 git 으로 관리한다.
 * 패키지는 매니페스트·락에서만 빠지고, 로컬 clone 은 건드리지 않는다.
 */
export async function remove(ctx: Ctx, raw: string): Promise<{ category: string; id: string; deleted?: string }> {
  const m = await loadManifest(ctx);
  const { category, id } = resolveKey(m, raw);
  const users = listRows(m).find((r) => r.category === category && r.id === id)!.usedBy;
  if (users.length) throw new Error(`${category}/${id} 는 프로필 ${users.join(", ")} 이 쓰고 있습니다. 먼저 프로필에서 빼세요.`);

  const text = await fs.readFile(manifestPath(ctx), "utf8");
  const doc = YAML.parseDocument(text);
  let deleted: string | undefined;

  if (category === PACKAGES) {
    const seq = doc.get(PACKAGES);
    if (!isSeq(seq)) throw new Error("packages 가 목록이 아닙니다");
    const idx = seq.items.findIndex((it) => isMap(it) && it.get("id") === id);
    seq.delete(idx);
    if (!seq.items.length) doc.delete(PACKAGES);
    const lock = await readLock(ctx.shed);
    if (lock.packages[id]) { delete lock.packages[id]; await writeLock(ctx.shed, lock); }
    ctx.log(`  - package ${id}  (매니페스트·락에서 제거. 로컬 clone 은 그대로)`);
  } else {
    const seq = doc.getIn(["components", category]);
    if (!isSeq(seq)) throw new Error(`components.${category} 가 목록이 아닙니다`);
    const idx = seq.items.findIndex((it) => isMap(it) && it.get("id") === id);
    seq.delete(idx);
    if (!seq.items.length) doc.deleteIn(["components", category]);
    const src = sourcePath(ctx, category, findComponent(m, category, id));
    const inside = !path.relative(ctx.shed, src).startsWith("..");
    if (inside && (await exists(src))) { await removeTree(src); deleted = src; }
    ctx.log(`  - ${category}/${id}${deleted ? "" : "  (창고 밖 경로라 파일은 두었음)"}`);
  }
  await fs.writeFile(manifestPath(ctx), doc.toString());
  return { category, id, deleted };
}

/** 어떤 프로필도 안 쓰는 것을 전부 뺀다. yes 가 아니면 목록만 보여준다. */
export async function prune(ctx: Ctx, opts: { yes?: boolean } = {}): Promise<string[]> {
  const m = await loadManifest(ctx);
  const unused = listRows(m).filter((r) => !r.usedBy.length);
  if (!unused.length) { ctx.log("미사용 항목이 없습니다."); return []; }
  if (!opts.yes) {
    ctx.log(`미사용 ${unused.length}개 (지우려면 --yes):`);
    for (const r of unused) ctx.log(`  ${r.category}/${r.id}`);
    return [];
  }
  const removed: string[] = [];
  for (const r of unused) { await remove(ctx, `${r.category}/${r.id}`); removed.push(`${r.category}/${r.id}`); }
  ctx.log(`\n${removed.length}개 제거. 창고를 커밋하세요: ${ctx.shed}`);
  return removed;
}
