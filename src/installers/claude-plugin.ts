import { promises as fs } from "node:fs";
import path from "node:path";
import type { Installer, DetectedPackage, InstallOpts, PkgStatus } from "./types.js";
import type { Ctx } from "../core/context.js";
import type { Package } from "../manifest.js";
import { parseSource } from "../source.js";

/**
 * Claude Code 플러그인 (§7.5).
 *   claude-marketplace:<owner/repo>          id = 마켓플레이스 이름
 *   claude-plugin:<name>@<marketplace>       id = 플러그인 이름
 * 설치 상태는 ~/.claude/plugins/*.json 을 직접 읽고, 설치는 `claude plugin ...` CLI 를 부른다.
 * 플러그인은 버전을 고정할 수 없다. 락은 "실제로 설치된 버전" 을 기록하고 status 가 차이를 알린다.
 */

interface InstalledFile { version: number; plugins: Record<string, { scope: string; version: string; gitCommitSha?: string }[]> }
interface MarketplacesFile { [name: string]: { source: { source: string; repo?: string; url?: string; path?: string } } }

async function readJson<T>(p: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as T; } catch { return fallback; }
}
const installedPath = (ctx: Ctx) => path.join(ctx.adapter.root, "plugins", "installed_plugins.json");
const marketplacesPath = (ctx: Ctx) => path.join(ctx.adapter.root, "plugins", "known_marketplaces.json");

function rest(pkg: Package): string {
  const s = parseSource(pkg.source);
  if (s.scheme !== "other") throw new Error(`package ${pkg.id}: ${pkg.source} 는 플러그인 출처가 아닙니다`);
  return s.rest;
}

async function claude(ctx: Ctx, args: string[]): Promise<void> {
  try {
    await ctx.exec("claude", args);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new Error("claude CLI 를 찾을 수 없습니다. Claude Code 가 설치되어 있어야 플러그인을 복원할 수 있습니다.");
    throw e;
  }
}

export const marketplaceInstaller: Installer = {
  name: "claude-marketplace",
  schemes: ["claude-marketplace"],
  priority: 10,

  async detect(ctx): Promise<DetectedPackage[]> {
    const m = await readJson<MarketplacesFile>(marketplacesPath(ctx), {});
    const out: DetectedPackage[] = [];
    for (const [name, v] of Object.entries(m)) {
      const src = v.source;
      if (src.source === "github" && src.repo) out.push({ id: name, source: `claude-marketplace:${src.repo}`, rev: src.repo });
      else ctx.log(`  ! marketplace ${name}: ${src.source} 출처는 아직 기록하지 못합니다 (건너뜀)`);
    }
    return out;
  },

  async status(ctx, pkg): Promise<PkgStatus> {
    const m = await readJson<MarketplacesFile>(marketplacesPath(ctx), {});
    const v = m[pkg.id];
    return { present: !!v, rev: v?.source.repo };
  },

  async install(ctx, pkg, _locked, _opts: InstallOpts): Promise<string> {
    const repo = rest(pkg);
    await claude(ctx, ["plugin", "marketplace", "add", repo, "--scope", "user"]);
    return repo;
  },

  async update(ctx, pkg): Promise<string> {
    await claude(ctx, ["plugin", "marketplace", "update", pkg.id]);
    return rest(pkg);
  },

  describe(pkg) { return `claude plugin marketplace add ${rest(pkg)}`; },
  cwd(ctx) { return ctx.adapter.root; },
};

export const pluginInstaller: Installer = {
  name: "claude-plugin",
  schemes: ["claude-plugin"],
  priority: 20,

  async detect(ctx): Promise<DetectedPackage[]> {
    const f = await readJson<InstalledFile>(installedPath(ctx), { version: 2, plugins: {} });
    const out: DetectedPackage[] = [];
    for (const [key, entries] of Object.entries(f.plugins)) {
      const e = entries.find((x) => x.scope === "user");
      if (!e) continue; // 프로젝트 범위 플러그인은 그 프로젝트의 몫 (§1.3)
      const [name] = key.split("@");
      out.push({ id: name, source: `claude-plugin:${key}`, rev: e.version });
    }
    return out;
  },

  async status(ctx, pkg): Promise<PkgStatus> {
    const f = await readJson<InstalledFile>(installedPath(ctx), { version: 2, plugins: {} });
    const e = f.plugins[rest(pkg)]?.find((x) => x.scope === "user");
    return { present: !!e, rev: e?.version };
  },

  async install(ctx, pkg, _locked, opts: InstallOpts): Promise<string> {
    await claude(ctx, ["plugin", "install", rest(pkg), "--scope", "user", ...(opts.yes ? ["-y"] : [])]);
    return (await this.status(ctx, pkg)).rev ?? "?";
  },

  async update(ctx, pkg): Promise<string> {
    await claude(ctx, ["plugin", "update", rest(pkg)]);
    return (await this.status(ctx, pkg)).rev ?? "?";
  },

  describe(pkg, locked) { return `claude plugin install ${rest(pkg)}${locked ? `  (전에 ${locked}; 고정은 안 됨)` : ""}`; },
  cwd(ctx) { return ctx.adapter.root; },
};
