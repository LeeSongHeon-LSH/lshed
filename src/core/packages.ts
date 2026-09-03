import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScannedComponent } from "../adapters/types.js";
import { type Ctx, installersFor, installerFor } from "./context.js";
import { isInside, realpathish } from "../fsutil.js";
import type { Package } from "../manifest.js";
import { readLock, writeLock, type Lock } from "../lock.js";
import { runShell } from "../git.js";
import type { DetectedPackage, InstallOpts } from "../installers/types.js";

export type { DetectedPackage } from "../installers/types.js";

/** 모든 설치기에게 "설치한 것" 을 묻는다 */
export async function detectPackages(ctx: Ctx, found: ScannedComponent[]): Promise<DetectedPackage[]> {
  const out: DetectedPackage[] = [];
  for (const inst of installersFor(ctx)) out.push(...(await inst.detect(ctx, found)));
  return out;
}

/**
 * "설치가 만들어낸 것": 최상위 항목 중 심볼릭 링크가 어떤 패키지 디렉터리 안을 가리키는 부품.
 * 반환값: 부품 키("category/id") → 만든 패키지 id. 디스크 위치가 있는 패키지(git 계열)만 본다.
 */
export async function detectGenerated(found: ScannedComponent[], pkgs: DetectedPackage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const located = pkgs.filter((p) => p.path);
  if (!located.length) return out;
  const roots = await Promise.all(located.map(async (p) => ({ id: p.id, real: await realpathish(p.path!) })));
  for (const f of found) {
    if (located.some((p) => p.path === f.path)) continue;
    let entries: string[];
    try {
      if (!(await fs.stat(f.path)).isDirectory()) continue;
      entries = await fs.readdir(f.path);
    } catch { continue; }
    for (const name of entries) {
      const p = path.join(f.path, name);
      let target: string;
      try {
        if (!(await fs.lstat(p)).isSymbolicLink()) continue;
        // 끊어진 링크여도 어디를 가리키는지는 안다 (패키지를 지운 뒤 남은 스텁).
        // 목적지가 없으면 realpath 가 실패하므로, 있는 데까지만 풀어서 견준다.
        target = await realpathish(path.resolve(f.path, await fs.readlink(p)));
      } catch { continue; }
      const owner = roots.find((r) => isInside(r.real, target));
      if (owner) { out.set(`${f.category}/${f.id}`, owner.id); break; }
    }
  }
  return out;
}

export interface PackageStatus { pkg: Package; present: boolean; rev?: string; locked?: string }

export async function packageStatus(ctx: Ctx, pkg: Package, lock: Lock): Promise<PackageStatus> {
  const st = await installerFor(ctx, pkg.source).status(ctx, pkg);
  return { pkg, ...st, locked: lock.packages[pkg.id]?.rev || undefined };
}

export type EnsureOptions = InstallOpts;
export interface EnsureResult { installed: string[]; pendingInstalls: { id: string; dir: string; cmd: string }[]; lockChanged: boolean }

const short = (r?: string) => (r && /^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r);

/** 설치 순서: 설치기 우선순위(마켓플레이스 < 플러그인), 같으면 매니페스트 순서 */
function ordered(ctx: Ctx, pkgs: Package[]): Package[] {
  return pkgs.map((p, i) => ({ p, i, pr: installerFor(ctx, p.source).priority })).sort((a, b) => a.pr - b.pr || a.i - b.i).map((x) => x.p);
}

/**
 * 프로필의 패키지를 갖춘다 (§3.7).
 *  - 없으면 설치기에 맡긴다. 락이 있으면 맞추려 하고, 못 맞추면 실제 버전을 락에 적는다.
 *  - 이미 있으면 건드리지 않는다. 락과 다르면 알려만 준다.
 *  - install: 셸 명령은 --yes 일 때만 실행한다.
 */
export async function ensurePackages(ctx: Ctx, pkgs: Package[], opts: EnsureOptions = {}): Promise<EnsureResult> {
  const lock = await readLock(ctx.shed);
  const res: EnsureResult = { installed: [], pendingInstalls: [], lockChanged: false };
  for (const pkg of ordered(ctx, pkgs)) {
    const inst = installerFor(ctx, pkg.source);
    const st = await packageStatus(ctx, pkg, lock);
    if (st.present) {
      const note = st.locked && st.rev !== st.locked ? `  (${short(st.rev)} ≠ lock ${short(st.locked)})` : "";
      ctx.log(`  = package ${pkg.id}${note}`);
      continue;
    }
    ctx.log(`  + package ${pkg.id}  (${inst.describe(pkg, st.locked)})`);
    if (opts.dryRun) continue;
    const rev = await inst.install(ctx, pkg, st.locked, opts);
    if (rev !== st.locked) {
      if (st.locked) ctx.log(`    락은 ${short(st.locked)} 이지만 ${short(rev)} 이 설치됨. 락을 따라가게 갱신`);
      lock.packages[pkg.id] = { source: pkg.source, rev };
      res.lockChanged = true;
    }
    res.installed.push(pkg.id);
    await maybeInstall(ctx, pkg, inst.cwd(ctx, pkg), opts, res);
  }
  if (res.lockChanged) await writeLock(ctx.shed, lock);
  return res;
}

export async function maybeInstall(ctx: Ctx, pkg: Package, dir: string, opts: InstallOpts, res: EnsureResult): Promise<void> {
  if (!pkg.install) return;
  if (opts.yes) {
    ctx.log(`  $ (${path.relative(ctx.adapter.root, dir) || "."}) ${pkg.install}`);
    await runShell(pkg.install, dir);
  } else {
    res.pendingInstalls.push({ id: pkg.id, dir, cmd: pkg.install });
  }
}

export function reportPending(ctx: Ctx, res: EnsureResult): void {
  if (!res.pendingInstalls.length) return;
  ctx.log(`\n설치 명령 ${res.pendingInstalls.length}개를 실행하지 않았습니다. 확인 후 '--yes' 로 다시 실행하거나 직접 돌리세요:`);
  for (const p of res.pendingInstalls) ctx.log(`  cd ${p.dir} && ${p.cmd}`);
}

/** lshed update: 패키지를 최신으로 올리고 락을 갱신한다. */
export async function updatePackages(ctx: Ctx, pkgs: Package[], opts: EnsureOptions = {}): Promise<EnsureResult> {
  const lock = await readLock(ctx.shed);
  const res: EnsureResult = { installed: [], pendingInstalls: [], lockChanged: false };
  for (const pkg of ordered(ctx, pkgs)) {
    const inst = installerFor(ctx, pkg.source);
    const st = await packageStatus(ctx, pkg, lock);
    if (!st.present) { ctx.log(`  ! package ${pkg.id}: 설치되어 있지 않음. 먼저 restore 하세요`); continue; }
    if (opts.dryRun) { ctx.log(`  ~ package ${pkg.id}  (${inst.name} update)`); continue; }
    const now = await inst.update(ctx, pkg, opts);
    const before = lock.packages[pkg.id]?.rev;
    if (now !== before) {
      lock.packages[pkg.id] = { source: pkg.source, rev: now };
      res.lockChanged = true;
      ctx.log(`  ↑ package ${pkg.id}  ${before ? short(before) : "(없음)"} → ${short(now)}`);
      await maybeInstall(ctx, pkg, inst.cwd(ctx, pkg), opts, res);
    } else {
      ctx.log(`  = package ${pkg.id}  ${short(now)} (최신)`);
    }
  }
  if (res.lockChanged) await writeLock(ctx.shed, lock);
  return res;
}
