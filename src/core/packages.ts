import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScannedComponent } from "../adapters/types.js";
import { type Ctx, abs } from "./context.js";
import type { Package } from "../manifest.js";
import { parseSource, cloneTarget, sourceFromRemote } from "../source.js";
import * as g from "../git.js";
import { readLock, writeLock, type Lock } from "../lock.js";
import { exists } from "../fsutil.js";

/** 스캔 결과 중 "설치한 것": 안에 .git 이 있고 origin 이 있는 부품 */
export interface DetectedPackage { id: string; into: string; source: string; commit: string; path: string }

export async function detectPackages(ctx: Ctx, found: ScannedComponent[]): Promise<DetectedPackage[]> {
  const out: DetectedPackage[] = [];
  for (const f of found) {
    if (!(await g.isRepo(f.path))) continue;
    const url = await g.remoteUrl(f.path);
    if (!url) continue; // 원격 없는 로컬 저장소는 그냥 내가 쓴 것으로 본다
    const into = path.relative(ctx.adapter.root, f.path).split(path.sep).join("/");
    out.push({ id: f.id, into, source: sourceFromRemote(url, await g.branch(f.path)), commit: await g.head(f.path), path: f.path });
  }
  return out;
}

/**
 * "설치가 만들어낸 것": 최상위 항목 중 심볼릭 링크가 어떤 패키지 디렉터리 안을 가리키는 부품.
 * 반환값: 부품 키("category/id") → 만든 패키지 id
 */
export async function detectGenerated(found: ScannedComponent[], pkgs: DetectedPackage[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!pkgs.length) return out;
  const roots = await Promise.all(pkgs.map(async (p) => ({ id: p.id, real: await fs.realpath(p.path) })));
  for (const f of found) {
    if (pkgs.some((p) => p.path === f.path)) continue;
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
        // 끊어진 링크여도 어디를 가리키는지는 안다 (패키지를 지운 뒤 남은 스텁)
        target = await fs.realpath(p).catch(async () => path.resolve(f.path, await fs.readlink(p)));
      } catch { continue; }
      const owner = roots.find((r) => target === r.real || target.startsWith(r.real + path.sep));
      if (owner) { out.set(`${f.category}/${f.id}`, owner.id); break; }
    }
  }
  return out;
}

export interface PackageStatus { pkg: Package; dir: string; present: boolean; head?: string; locked?: string }

export async function packageStatus(ctx: Ctx, pkg: Package, lock: Lock): Promise<PackageStatus> {
  const dir = abs(ctx, pkg.into);
  const present = await g.isRepo(dir);
  return { pkg, dir, present, head: present ? await g.head(dir) : undefined, locked: lock.packages[pkg.id]?.commit };
}

export interface EnsureOptions { dryRun?: boolean; yes?: boolean }
export interface EnsureResult { cloned: string[]; pendingInstalls: { id: string; dir: string; cmd: string }[]; lockChanged: boolean }

/**
 * 프로필의 패키지를 갖춘다 (§3.7).
 *  - 없으면 clone 하고 락의 커밋으로 맞춘다 (락이 없으면 지금 HEAD 를 락에 기록).
 *  - 이미 있으면 건드리지 않는다. 사용자가 올렸을 수 있다. 락과 다르면 status 가 알려준다.
 *  - install 은 --yes 일 때만 실행한다. 아니면 명령을 보여주고 넘어간다.
 */
export async function ensurePackages(ctx: Ctx, pkgs: Package[], opts: EnsureOptions = {}): Promise<EnsureResult> {
  const lock = await readLock(ctx.shed);
  const res: EnsureResult = { cloned: [], pendingInstalls: [], lockChanged: false };
  for (const pkg of pkgs) {
    const st = await packageStatus(ctx, pkg, lock);
    if (st.present) {
      const note = st.locked && st.head !== st.locked ? `  (HEAD ${st.head!.slice(0, 7)} ≠ lock ${st.locked.slice(0, 7)})` : "";
      ctx.log(`  = package ${pkg.id}${note}`);
      continue;
    }
    if (await exists(st.dir)) throw new Error(`package ${pkg.id}: ${st.dir} 가 있지만 git 저장소가 아닙니다. 치우거나 into 를 바꾸세요.`);
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    ctx.log(`  + package ${pkg.id}  (clone ${url}${ref ? ` @${ref}` : ""}${st.locked ? ` → ${st.locked.slice(0, 7)}` : ""})`);
    if (opts.dryRun) continue;
    await fs.mkdir(path.dirname(st.dir), { recursive: true });
    await g.clone(url, st.dir, ref);
    if (st.locked) {
      await g.resetHard(st.dir, st.locked).catch(() => {
        throw new Error(`package ${pkg.id}: 락의 커밋 ${st.locked!.slice(0, 7)} 을 찾을 수 없습니다. 'lshed update ${pkg.id}' 로 락을 갱신하세요.`);
      });
    } else {
      lock.packages[pkg.id] = { source: pkg.source, commit: await g.head(st.dir) };
      res.lockChanged = true;
    }
    res.cloned.push(pkg.id);
    if (pkg.install) await maybeInstall(ctx, pkg, st.dir, opts, res);
  }
  if (res.lockChanged) await writeLock(ctx.shed, lock);
  return res;
}

export async function maybeInstall(ctx: Ctx, pkg: Package, dir: string, opts: EnsureOptions, res: EnsureResult): Promise<void> {
  if (!pkg.install) return;
  if (opts.yes) {
    ctx.log(`  $ (${pkg.into}) ${pkg.install}`);
    await g.runShell(pkg.install, dir);
  } else {
    res.pendingInstalls.push({ id: pkg.id, dir, cmd: pkg.install });
  }
}

export function reportPending(ctx: Ctx, res: EnsureResult): void {
  if (!res.pendingInstalls.length) return;
  ctx.log(`\n설치 명령 ${res.pendingInstalls.length}개를 실행하지 않았습니다. 확인 후 '--yes' 로 다시 실행하거나 직접 돌리세요:`);
  for (const p of res.pendingInstalls) ctx.log(`  cd ${p.dir} && ${p.cmd}`);
}

/** lshed update: 패키지를 원격 최신으로 올리고 락을 갱신한다. */
export async function updatePackages(ctx: Ctx, pkgs: Package[], opts: EnsureOptions = {}): Promise<EnsureResult> {
  const lock = await readLock(ctx.shed);
  const res: EnsureResult = { cloned: [], pendingInstalls: [], lockChanged: false };
  for (const pkg of pkgs) {
    const st = await packageStatus(ctx, pkg, lock);
    if (!st.present) { ctx.log(`  ! package ${pkg.id}: 설치되어 있지 않음. 먼저 restore 하세요`); continue; }
    if (opts.dryRun) { ctx.log(`  ~ package ${pkg.id}  (git pull --ff-only)`); continue; }
    await g.pullFf(st.dir);
    const now = await g.head(st.dir);
    const before = lock.packages[pkg.id]?.commit;
    if (now !== before) {
      lock.packages[pkg.id] = { source: pkg.source, commit: now };
      res.lockChanged = true;
      ctx.log(`  ↑ package ${pkg.id}  ${before ? before.slice(0, 7) : "(없음)"} → ${now.slice(0, 7)}`);
      await maybeInstall(ctx, pkg, st.dir, opts, res);
    } else {
      ctx.log(`  = package ${pkg.id}  ${now.slice(0, 7)} (최신)`);
    }
  }
  if (res.lockChanged) await writeLock(ctx.shed, lock);
  return res;
}
