import { type Ctx, loadManifest, planProfile, abs, ignoreOf, kindOf } from "./context.js";
import { matches, readEntryFile, remask, writeEntryFile, type Json } from "./entries.js";
import { readState } from "../state.js";
import { copyTree, exists, hashTree } from "../fsutil.js";
import { isSaveable } from "../resolvers/file.js";
import { effectiveSource, parseKey } from "../manifest.js";

/**
 * 로컬 편집 → 창고 (§3.4). file: 출처만. ids 를 주면 그것만, 없으면 현재 프로필 전체.
 * id 는 "category/id" 또는 "id" (모호하면 오류).
 */
export async function save(ctx: Ctx, ids: string[] = []): Promise<string[]> {
  const state = await readState(ctx.adapter);
  if (!state) throw new Error("No profile applied. Run 'lshed restore <profile>' first.");
  const m = await loadManifest(ctx);
  let plan = planProfile(ctx, m, state.profile);

  if (ids.length) {
    plan = ids.map((raw) => {
      const k = parseKey(raw);
      let hits = plan.filter((p) => p.id === k.id && (k.category === undefined || p.category === k.category));
      if (!hits.length && k.category !== undefined) hits = plan.filter((p) => p.id === raw); // id 자체에 / 가 있는 경우
      if (!hits.length) throw new Error(`"${raw}" is not in the current profile (${state.profile})`);
      if (hits.length > 1) throw new Error(`"${raw}" is ambiguous: ${hits.map((h) => `${h.category}/${h.id}`).join(", ")}`);
      return hits[0];
    });
  }

  const saved: string[] = [];
  const localEntries = new Map<string, Record<string, unknown>>();
  for (const it of plan) {
    const src = effectiveSource(it.category, it.component, kindOf(ctx, it.category));
    if (!isSaveable(src)) { ctx.log(`  ! ${it.category}/${it.id}: a remote source (${src}) cannot be saved`); continue; }
    if (it.entry) {
      // 항목형: 창고의 자리표시자는 보존하고, 새로 생긴 시크릿 키는 마스킹해서 되가져온다
      if (!localEntries.has(it.category)) localEntries.set(it.category, await it.entry.read());
      const local = localEntries.get(it.category)![it.id] as Json | undefined;
      if (local === undefined) { ctx.log(`  ! ${it.category}/${it.id}: not present locally (skipped)`); continue; }
      const shed = await readEntryFile(it.src);
      if (shed !== null && matches(shed, local)) continue;
      await writeEntryFile(it.src, remask(it.id, local, shed, it.entry));
      saved.push(`${it.category}/${it.id}`);
      ctx.log(`  ✓ ${it.category}/${it.id} → shed  (secrets as placeholders)`);
      continue;
    }
    const local = abs(ctx, it.rel);
    if (!(await exists(local))) { ctx.log(`  ! ${it.category}/${it.id}: not present locally (skipped)`); continue; }
    if ((await hashTree(local, ignoreOf(ctx))) === (await hashTree(it.src, ignoreOf(ctx)))) continue;
    await copyTree(local, it.src, ignoreOf(ctx));
    saved.push(`${it.category}/${it.id}`);
    ctx.log(`  ✓ ${it.category}/${it.id} → shed`);
  }
  ctx.log(saved.length ? `\n${saved.length} saved. Commit or sync the shed: ${ctx.shed}` : "Nothing to save.");
  return saved;
}
