import type { Ctx } from "./context.js";
import { readState, type State } from "../state.js";
import { diff } from "./diff.js";
import { loadManifest } from "./context.js";
import { packagesOf } from "../manifest.js";
import { readLock } from "../lock.js";
import { packageStatus, type PackageStatus } from "./packages.js";
import { planProfile } from "./context.js";
import { expand, readEntryFile } from "./entries.js";
import { candidates } from "./add.js";
import { keyOf } from "./discover.js";

export interface Status {
  state: State | null;
  drifted: string[];
  packages: PackageStatus[];
  missingEnv: { rel: string; vars: string[] }[];
  /** 로컬에 있는데 창고에 없는 것 → lshed add */
  fresh: string[];
}

export async function status(ctx: Ctx): Promise<Status> {
  const state = await readState(ctx.adapter);
  if (!state) return { state: null, drifted: [], packages: [], missingEnv: [], fresh: [] };
  const d = await diff(ctx);
  const m = await loadManifest(ctx);
  const lock = await readLock(ctx.shed);
  const packages = await Promise.all(packagesOf(m, state.profile).map((p) => packageStatus(ctx, p, lock)));
  const missingEnv: Status["missingEnv"] = [];
  for (const it of planProfile(ctx, m, state.profile).filter((p) => p.entry)) {
    const shed = await readEntryFile(it.src);
    const missing = shed === null ? [] : expand(shed).missing;
    if (missing.length) missingEnv.push({ rel: it.rel, vars: missing });
  }
  const fresh = (await candidates(ctx, m, state.profile)).fresh.map(keyOf);
  return { state, drifted: d.map((x) => `${x.item.category}/${x.item.id}`), packages, missingEnv, fresh };
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
  const short = (r?: string) => (r && /^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);
  for (const p of s.packages) {
    const where = !p.present ? "설치 안 됨 → lshed restore" : !p.locked ? `${short(p.rev)} (락 없음)` : p.rev === p.locked ? `${short(p.rev)} = lock` : `${short(p.rev)} ≠ lock ${short(p.locked)} → lshed update`;
    lines.push(`패키지   ${p.pkg.id}  ${where}`);
  }
  for (const m of s.missingEnv) lines.push(`환경변수 ${m.rel}: ${m.vars.join(", ")} 없음  → 셸에서 export 하세요`);
  if (s.fresh.length) lines.push(`창고 밖  ${s.fresh.length}개: ${s.fresh.join(", ")}  → lshed add`);
  return lines.join("\n");
}
