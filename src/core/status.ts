import type { Ctx } from "./context.js";
import { readState, type State } from "../state.js";
import { diff } from "./diff.js";
import { loadManifest } from "./context.js";
import { installablePackages } from "./context.js";
import { readLock } from "../lock.js";
import { packageStatus, type PackageStatus } from "./packages.js";
import { planProfile } from "./context.js";
import { expand, envWithHome, readEntryFile } from "./entries.js";
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
  // 이 에이전트로 설치할 수 없는 패키지는 이 기기의 관심사가 아니다 (restore 도 건너뛴다)
  const packages = await Promise.all(installablePackages(ctx, m, state.profile).packages.map((p) => packageStatus(ctx, p, lock)));
  const missingEnv: Status["missingEnv"] = [];
  for (const it of planProfile(ctx, m, state.profile).filter((p) => p.entry)) {
    const shed = await readEntryFile(it.src);
    const missing = shed === null ? [] : expand(shed, envWithHome()).missing;
    if (missing.length) missingEnv.push({ rel: it.rel, vars: missing });
  }
  const fresh = (await candidates(ctx, m, state.profile)).fresh.map(keyOf);
  return { state, drifted: d.map((x) => `${x.item.category}/${x.item.id}`), packages, missingEnv, fresh };
}

/**
 * 사람이 읽는 status. 행의 집합은 늘 같다 (첫 블록: 무엇이 어디에, 둘째 블록: 상태) — 문제가 없을 때도 "none" 으로 자리를 지켜
 * 눈이 늘 같은 자리를 보게 한다. 문제가 있는 항목만 "!" 로 시작하는 들여쓴 줄에 하나씩 풀어 쓰고, 나머지는 한 줄에 쉼표로 나열한다.
 */
export function formatStatus(s: Status, adapterRoot: string, agent = "claude-code"): string {
  if (!s.state) return `No profile applied (${agent}: ${adapterRoot}).\n  lshed init --shed <dir>   or   lshed restore <profile>`;
  const row = (label: string, text: string) => `${label.padEnd(9)}  ${text}`;
  const detail = (id: string, w: number, text: string) => `${" ".repeat(11)}! ${id.padEnd(w)}  ${text}`;
  const lines = [
    row("profile", s.state.profile),
    row("shed", s.state.shed),
    row("applied", s.state.appliedAt),
    row("managed", `${s.state.managed.length} paths (${agent}: ${adapterRoot})`),
    row("placement", s.state.link ? "links (file parts point into the shed; edits land there directly)" : "copies"),
    "",
    row("drift", s.drifted.length ? `${s.drifted.length}: ${s.drifted.join(", ")}  → lshed diff` : "none"),
  ];
  const short = (r?: string) => (r && /^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);
  const inSync = s.packages.filter((p) => p.present && p.locked && p.rev === p.locked);
  const off = s.packages.filter((p) => !inSync.includes(p));
  if (!s.packages.length) lines.push(row("packages", "none"));
  else {
    const n = off.length ? `${inSync.length} of ${s.packages.length}` : `${s.packages.length}`;
    lines.push(row("packages", `${n} in sync${inSync.length ? `: ${inSync.map((p) => p.pkg.id).join(", ")}` : ""}`));
    const w = Math.max(...off.map((p) => p.pkg.id.length));
    for (const p of off) {
      const what = !p.present ? "not installed  → lshed restore" : !p.locked ? `${short(p.rev)} (not in lock)` : `${short(p.rev)} ≠ lock ${short(p.locked)}  → lshed update`;
      lines.push(detail(p.pkg.id, w, what));
    }
  }
  const nEnv = s.missingEnv.reduce((n, m) => n + m.vars.length, 0);
  lines.push(row("env", nEnv ? `${nEnv} not set` : "all set"));
  const wEnv = Math.max(0, ...s.missingEnv.map((m) => m.rel.length));
  for (const m of s.missingEnv) lines.push(detail(m.rel, wEnv, `${m.vars.join(", ")}  → export in your shell`));
  lines.push(row("outside", s.fresh.length ? `${s.fresh.length}: ${s.fresh.join(", ")}  → lshed add` : "none"));
  return lines.join("\n");
}
