import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { restore } from "../src/core/restore.js";
import { status } from "../src/core/status.js";
import { updatePackages } from "../src/core/packages.js";
import { readLock } from "../src/lock.js";

let tmp: string, rootA: string, rootB: string, shed: string, logs: string[], calls: string[][];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const J = (o: unknown) => JSON.stringify(o, null, 1);

/** 가짜 `claude` CLI: 실제 Claude Code 가 하듯 plugins/*.json 을 고친다 */
function fakeExec(root: string) {
  const inst = path.join(root, "plugins/installed_plugins.json");
  const mk = path.join(root, "plugins/known_marketplaces.json");
  const rd = async (p: string, d: unknown) => { try { return JSON.parse(await r(p)); } catch { return d; } };
  return async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (cmd !== "claude") throw new Error("unexpected " + cmd);
    const [, sub, a, b] = args;
    if (sub === "marketplace" && a === "add") {
      const m = await rd(mk, {});
      m[b.split("/")[1]] = { source: { source: "github", repo: b } };
      await w(mk, J(m));
    } else if (sub === "install") {
      const m = await rd(mk, {});
      if (!m[a.split("@")[1]]) throw new Error(`marketplace not known: ${a}`);
      const f = await rd(inst, { version: 2, plugins: {} });
      f.plugins[a] = [{ scope: "user", version: "9.9.9", installPath: "/x" }];
      await w(inst, J(f));
    } else if (sub === "update") {
      const f = await rd(inst, { version: 2, plugins: {} });
      f.plugins[a][0].version = "10.0.0";
      await w(inst, J(f));
    }
  };
}
const ctxFor = (root: string): Ctx => ({ adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: fakeExec(root) });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-plg-"));
  rootA = path.join(tmp, "A"); rootB = path.join(tmp, "B"); shed = path.join(tmp, "shed"); logs = []; calls = [];
  // 기기 A: 공식 마켓플레이스 + 플러그인 2개(user) + 프로젝트 범위 1개
  await w(path.join(rootA, "plugins/known_marketplaces.json"), J({ "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } } }));
  await w(path.join(rootA, "plugins/installed_plugins.json"), J({ version: 2, plugins: {
    "exa@claude-plugins-official": [{ scope: "user", version: "3.4.1", installPath: "/x" }],
    "notion@claude-plugins-official": [{ scope: "user", version: "0.1.0", installPath: "/x" }],
    "proj-only@claude-plugins-official": [{ scope: "project", version: "1.0.0", installPath: "/x" }],
  } }));
  await w(path.join(rootA, "skills/mine/SKILL.md"), "authored");
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("init: 플러그인과 마켓플레이스를 패키지로 기록", () => {
  it("user 범위만, into 없이, 버전을 락에", async () => {
    const res = await init(ctxFor(rootA));
    expect(res.packages.sort()).toEqual(["claude-plugins-official", "exa", "notion"]);
    const m = res.manifest;
    expect(m.packages.find((p) => p.id === "claude-plugins-official")).toEqual({ id: "claude-plugins-official", source: "claude-marketplace:anthropics/claude-plugins-official" });
    expect(m.packages.find((p) => p.id === "exa")).toEqual({ id: "exa", source: "claude-plugin:exa@claude-plugins-official" });
    expect(m.packages.map((p) => p.id)).not.toContain("proj-only");
    const lock = await readLock(shed);
    expect(lock.packages.exa.rev).toBe("3.4.1");
    expect(await r(path.join(shed, "lshed.yaml"))).not.toContain("# install:");   // 플러그인엔 자리표시자 없음
  });
});

describe("restore: 새 기기", () => {
  beforeEach(() => init(ctxFor(rootA)));

  it("마켓플레이스를 먼저 추가하고 플러그인을 설치한다. 락과 다르면 락이 따라간다", async () => {
    const ctx = ctxFor(rootB);
    const res = await restore(ctx, "default");
    expect(calls.map((c) => c.slice(1).filter((x) => x !== "--scope" && x !== "user").join(" "))).toEqual([
      "plugin marketplace add anthropics/claude-plugins-official",
      "plugin install exa@claude-plugins-official",
      "plugin install notion@claude-plugins-official",
    ]);
    expect(res.placed).toEqual(["skills/mine"]);
    const lock = await readLock(shed);
    expect(lock.packages.exa.rev).toBe("9.9.9");          // 고정 불가 → 실제 설치 버전으로
    expect(logs.join("\n")).toMatch(/락은 3.4.1 이지만 9.9.9/);
    const s = await status(ctx);
    expect(s.packages.map((p) => `${p.pkg.id}:${p.present}:${p.rev}`).sort()).toEqual(["claude-plugins-official:true:anthropics/claude-plugins-official", "exa:true:9.9.9", "notion:true:9.9.9"]);
  });

  it("--yes 는 claude 에 -y 로 전달된다", async () => {
    await restore(ctxFor(rootB), "default", { yes: true });
    expect(calls.find((c) => c[2] === "install")).toContain("-y");
  });

  it("--dry-run 은 아무것도 부르지 않는다", async () => {
    await restore(ctxFor(rootB), "default", { dryRun: true });
    expect(calls).toEqual([]);
  });

  it("이미 있는 것은 다시 설치하지 않는다 (기기 A 에서 재적용)", async () => {
    await restore(ctxFor(rootA), "default");
    expect(calls).toEqual([]);
  });

  it("claude CLI 가 없으면 분명한 오류", async () => {
    const ctx = ctxFor(rootB);
    ctx.exec = async () => { const e = new Error("spawn claude ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; };
    await expect(restore(ctx, "default")).rejects.toThrow(/claude CLI 를 찾을 수 없습니다/);
  });
});

describe("update", () => {
  it("플러그인을 올리고 락을 갱신", async () => {
    await init(ctxFor(rootA));
    const ctx = ctxFor(rootA);
    const { parseManifest } = await import("../src/manifest.js");
    const m = parseManifest(await r(path.join(shed, "lshed.yaml")));
    const res = await updatePackages(ctx, m.packages.filter((p) => p.id === "exa"));
    expect(res.lockChanged).toBe(true);
    expect((await readLock(shed)).packages.exa.rev).toBe("10.0.0");
    expect(calls).toEqual([["claude", "plugin", "update", "exa@claude-plugins-official"]]);
  });
});
