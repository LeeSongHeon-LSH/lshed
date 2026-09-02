import type { Ctx } from "./context.js";
import { readState, type State } from "../state.js";
import { diff } from "./diff.js";
import { loadManifest } from "./context.js";
import { packagesOf } from "../manifest.js";
import { readLock } from "../lock.js";
import { packageStatus, type PackageStatus } from "./packages.js";

export interface Status { state: State | null; drifted: string[]; packages: PackageStatus[] }

export async function status(ctx: Ctx): Promise<Status> {
  const state = await readState(ctx.adapter);
  if (!state) return { state: null, drifted: [], packages: [] };
  const d = await diff(ctx);
  const m = await loadManifest(ctx);
  const lock = await readLock(ctx.shed);
  const packages = await Promise.all(packagesOf(m, state.profile).map((p) => packageStatus(ctx, p, lock)));
  return { state, drifted: d.map((x) => `${x.item.category}/${x.item.id}`), packages };
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
  for (const p of s.packages) {
    const where = !p.present ? "설치 안 됨 → lshed restore" : !p.locked ? `${p.head!.slice(0, 7)} (락 없음)` : p.head === p.locked ? `${p.head!.slice(0, 7)} = lock` : `${p.head!.slice(0, 7)} ≠ lock ${p.locked.slice(0, 7)} → lshed update`;
    lines.push(`패키지   ${p.pkg.id}  ${where}`);
  }
  return lines.join("\n");
}
