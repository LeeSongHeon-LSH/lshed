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
  if (!pkg.into) throw new Error(`package ${pkg.id}: git 계열 패키지는 into 가 필요합니다`);
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
    if (await exists(dir)) throw new Error(`package ${pkg.id}: ${dir} 가 있지만 git 저장소가 아닙니다. 치우거나 into 를 바꾸세요.`);
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await g.clone(url, dir, ref);
    if (locked) {
      await g.resetHard(dir, locked).catch(() => {
        throw new Error(`package ${pkg.id}: 락의 커밋 ${locked.slice(0, 7)} 을 찾을 수 없습니다. 'lshed update ${pkg.id}' 로 락을 갱신하세요.`);
      });
    }
    return g.head(dir);
  },

  async update(ctx, pkg): Promise<string> {
    const dir = dirOf(ctx, pkg);
    await g.pullFf(dir);
    return g.head(dir);
  },

  describe(pkg, locked) {
    const { url, ref } = cloneTarget(parseSource(pkg.source));
    return `clone ${url}${ref ? ` @${ref}` : ""}${locked ? ` → ${locked.slice(0, 7)}` : ""}`;
  },

  cwd: dirOf,
};
