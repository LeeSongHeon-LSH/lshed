import { promises as fs } from "node:fs";
import path from "node:path";
import type { Installer, DetectedPackage, InstallOpts, PkgStatus } from "./types.js";
import type { Ctx } from "../core/context.js";
import type { Package } from "../manifest.js";
import type { ScannedComponent } from "../adapters/types.js";
import { parseSource, cloneTarget, sourceFromRemote } from "../source.js";
import * as g from "../git.js";
import { exists } from "../fsutil.js";

function dirOf(ctx: Ctx, pkg: Package): string {
  if (!pkg.into) throw new Error(`package ${pkg.id}: a git package needs into`);
  return path.join(ctx.adapter.root, ...pkg.into.split("/"));
}

/** github: / git: — clone 하고 락 커밋으로 맞춘다 */
export const gitInstaller: Installer = {
  name: "git",
  schemes: ["github", "git"],
  priority: 0,

  async detect(ctx: Ctx, found: ScannedComponent[]): Promise<DetectedPackage[]> {
    const out: DetectedPackage[] = [];
    for (const f of found) {
      if (!(await g.isRepo(f.path))) continue;
      const url = await g.remoteUrl(f.path);
      if (!url) continue; // 원격 없는 로컬 저장소는 내가 쓴 것으로 본다
      const into = path.relative(ctx.adapter.root, f.path).split(path.sep).join("/");
      out.push({ id: f.id, into, source: sourceFromRemote(url, await g.branch(f.path)), rev: await g.head(f.path), path: f.path });
    }
    return out;
  },

  async status(ctx, pkg): Promise<PkgStatus> {
    const dir = dirOf(ctx, pkg);
    const present = await g.isRepo(dir);
    return { present, rev: present ? await g.head(dir) : undefined };
  },

  async install(ctx, pkg, locked, _opts: InstallOpts): Promise<string> {
    const dir = dirOf(ctx, pkg);
    if (await exists(dir)) throw new Error(`package ${pkg.id}: ${dir} exists but is not a git repository. Move it away or change into.`);
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await g.clone(url, dir, ref);
    if (locked) {
      await g.resetHard(dir, locked).catch(() => {
        throw new Error(`package ${pkg.id}: the locked commit ${locked.slice(0, 7)} was not found. Refresh the lock with 'lshed update ${pkg.id}'.`);
      });
    }
    return g.head(dir);
  },

  async update(ctx, pkg): Promise<string> {
    const dir = dirOf(ctx, pkg);
    await g.pullFf(dir);
    return g.head(dir);
  },

  /** clone 의 HEAD 와 출처 브랜치의 원격 커밋. pull --ff-only 가 옮길 거리 그대로 */
  async upstream(ctx, pkg) {
    const dir = dirOf(ctx, pkg);
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    return { current: await g.head(dir), latest: await g.lsRemote(url, ref) };
  },

  describe(pkg, locked) {
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    return `clone ${url}${ref ? ` @${ref}` : ""}${locked ? ` → ${locked.slice(0, 7)}` : ""}`;
  },

  cwd: dirOf,
};
