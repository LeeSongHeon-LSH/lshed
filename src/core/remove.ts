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
  if (!hits.length) throw new Error(`"${raw}" is not in the shed`);
  if (hits.length > 1) throw new Error(`"${raw}" is ambiguous: ${hits.map((h) => `${h.category}/${h.id}`).join(", ")}`);
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
  if (users.length) throw new Error(`${category}/${id} is still used by ${users.length > 1 ? "profiles" : "profile"} ${users.join(", ")}. Take it out of the profile first.`);

  const text = await fs.readFile(manifestPath(ctx), "utf8");
  const doc = YAML.parseDocument(text);
  let deleted: string | undefined;

  if (category === PACKAGES) {
    const seq = doc.get(PACKAGES);
    if (!isSeq(seq)) throw new Error("packages is not a list");
    const idx = seq.items.findIndex((it) => isMap(it) && it.get("id") === id);
    seq.delete(idx);
    if (!seq.items.length) doc.delete(PACKAGES);
    const lock = await readLock(ctx.shed);
    if (lock.packages[id]) { delete lock.packages[id]; await writeLock(ctx.shed, lock); }
    ctx.log(`  - package ${id}  (removed from the manifest and lock; the local clone stays)`);
  } else {
    const seq = doc.getIn(["components", category]);
    if (!isSeq(seq)) throw new Error(`components.${category} is not a list`);
    const idx = seq.items.findIndex((it) => isMap(it) && it.get("id") === id);
    seq.delete(idx);
    if (!seq.items.length) doc.deleteIn(["components", category]);
    const src = sourcePath(ctx, category, findComponent(m, category, id));
    const inside = !path.relative(ctx.shed, src).startsWith("..");
    if (inside && (await exists(src))) { await removeTree(src); deleted = src; }
    ctx.log(`  - ${category}/${id}${deleted ? "" : "  (path is outside the shed, file left alone)"}`);
  }
  await fs.writeFile(manifestPath(ctx), doc.toString());
  return { category, id, deleted };
}

/** 어떤 프로필도 안 쓰는 것을 전부 뺀다. yes 가 아니면 목록만 보여준다. */
export async function prune(ctx: Ctx, opts: { yes?: boolean } = {}): Promise<string[]> {
  const m = await loadManifest(ctx);
  const unused = listRows(m).filter((r) => !r.usedBy.length);
  if (!unused.length) { ctx.log("Nothing unused."); return []; }
  if (!opts.yes) {
    ctx.log(`${unused.length} unused (pass --yes to delete):`);
    for (const r of unused) ctx.log(`  ${r.category}/${r.id}`);
    return [];
  }
  const removed: string[] = [];
  for (const r of unused) { await remove(ctx, `${r.category}/${r.id}`); removed.push(`${r.category}/${r.id}`); }
  ctx.log(`\n${removed.length} removed. Commit the shed: ${ctx.shed}`);
  return removed;
}
