import { type Ctx, loadManifest, planProfile, abs, type PlanItem, ignoreOf } from "./context.js";
import { readState } from "../state.js";
import { diffTrees, type FileChange } from "../fsutil.js";
import { diffEntry, readEntryFile, type Json } from "./entries.js";

export interface ComponentDiff { item: PlanItem; changes: FileChange[] }

/** 현재 프로필의 각 부품에 대해 로컬 vs 창고 파일 단위 차이 (§5). */
export async function diff(ctx: Ctx): Promise<ComponentDiff[]> {
  const state = await readState(ctx.adapter);
  if (!state) throw new Error("적용된 프로필이 없습니다. 먼저 'lshed restore <profile>' 을 실행하세요.");
  const m = await loadManifest(ctx);
  const out: ComponentDiff[] = [];
  const localEntries = new Map<string, Record<string, unknown>>();
  for (const item of planProfile(ctx, m, state.profile)) {
    let changes: FileChange[];
    if (item.entry) {
      if (!localEntries.has(item.category)) localEntries.set(item.category, await item.entry.read());
      const shed = await readEntryFile(item.src);
      changes = shed === null ? [{ status: "A", file: "(entry)" }] : diffEntry(shed, localEntries.get(item.category)![item.id] as Json | undefined);
    } else {
      changes = await diffTrees(abs(ctx, item.rel), item.src, ignoreOf(ctx));
    }
    if (changes.length) out.push({ item, changes });
  }
  return out;
}

export function formatDiff(diffs: ComponentDiff[]): string {
  if (!diffs.length) return "로컬과 창고가 일치합니다.";
  const lines: string[] = [];
  for (const d of diffs) {
    lines.push(`${d.item.category}/${d.item.id}`);
    for (const c of d.changes) lines.push(`  ${c.status} ${c.file || "(file)"}`);
  }
  lines.push("", "A: 로컬에만 있음  M: 내용 다름  D: 창고에만 있음", "로컬 편집을 창고에 반영하려면: lshed save");
  return lines.join("\n");
}
