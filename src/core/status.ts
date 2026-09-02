import type { Ctx } from "./context.js";
import { readState, type State } from "../state.js";
import { diff } from "./diff.js";

export interface Status { state: State | null; drifted: string[] }

export async function status(ctx: Ctx): Promise<Status> {
  const state = await readState(ctx.adapter);
  if (!state) return { state: null, drifted: [] };
  const d = await diff(ctx);
  return { state, drifted: d.map((x) => `${x.item.category}/${x.item.id}`) };
}

export function formatStatus(s: Status, adapterRoot: string): string {
  if (!s.state) return `적용된 프로필이 없습니다 (${adapterRoot}).\n  lshed init --shed <dir>   또는   lshed restore <profile>`;
  const lines = [
    `프로필   ${s.state.profile}`,
    `창고     ${s.state.shed}`,
    `적용     ${s.state.appliedAt}`,
    `관리 중  ${s.state.managed.length}개 경로 (${adapterRoot})`,
  ];
  lines.push(s.drifted.length ? `드리프트 ${s.drifted.length}개: ${s.drifted.join(", ")}  → lshed diff` : "드리프트 없음");
  return lines.join("\n");
}
