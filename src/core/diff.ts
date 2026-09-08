import { type Ctx, loadManifest, planProfile, abs, type PlanItem, ignoreOf } from "./context.js";
import { readState } from "../state.js";
import { diffTrees, type FileChange } from "../fsutil.js";
import { diffEntry, readEntryFile, type Json } from "./entries.js";

export interface ComponentDiff { item: PlanItem; changes: FileChange[] }

/** 현재 프로필의 각 부품에 대해 로컬 vs 창고 파일 단위 차이 (§5). */
export async function diff(ctx: Ctx): Promise<ComponentDiff[]> {
  const state = await readState(ctx.adapter);
  if (!state) throw new Error("No profile applied. Run 'lshed restore <profile>' first.");
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
  if (!diffs.length) return "Local and shed match.";
  const lines: string[] = [];
  for (const d of diffs) {
    lines.push(`${d.item.category}/${d.item.id}`);
    for (const c of d.changes) lines.push(`  ${c.status} ${c.file || "(file)"}`);
  }
  lines.push("", "A: only local  M: differs  D: only in the shed", "To copy local edits into the shed: lshed save");
  return lines.join("\n");
}
