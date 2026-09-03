import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { restore } from "../src/core/restore.js";
import { sync } from "../src/core/sync.js";
import { git } from "../src/git.js";

let tmp: string, rootA: string, rootB: string, shedA: string, shedB: string, bare: string, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const G = (args: string[], cwd: string) => git(["-c", "user.name=t", "-c", "user.email=t@t", ...args], cwd);
const ctxFor = (root: string, shed: string): Ctx => ({ adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-sync-"));
  rootA = path.join(tmp, "A"); rootB = path.join(tmp, "B"); shedA = path.join(tmp, "shedA"); shedB = path.join(tmp, "shedB"); bare = path.join(tmp, "origin.git"); logs = [];
  await w(path.join(rootA, "skills/alpha/SKILL.md"), "alpha v1");
  await init(ctxFor(rootA, shedA));
  await git(["init", "-q", "--bare", "-b", "main", bare]);
  await git(["init", "-q", "-b", "main"], shedA);
  await git(["remote", "add", "origin", bare], shedA);
  await git(["config", "user.name", "t"], shedA); await git(["config", "user.email", "t@t"], shedA);
  logs = [];
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("lshed sync", () => {
  it("git 저장소가 아니면 안내하고 멈춘다", async () => {
    await expect(sync(ctxFor(rootA, path.join(tmp, "plain")))).rejects.toThrow(/git init/);
  });

  it("첫 sync: 커밋 + upstream 설정 push. 두 번째는 변경 없음", async () => {
    const ctx = ctxFor(rootA, shedA);
    const res = await sync(ctx);
    expect(res.committed).toEqual(expect.arrayContaining(["lshed.yaml", "skills/alpha/SKILL.md"]));
    expect(res.pushed).toBe(true);
    expect(await git(["log", "-1", "--format=%s"], bare)).toMatch(/^lshed sync: /);
    expect(await git(["rev-parse", "--abbrev-ref", "@{upstream}"], shedA)).toBe("origin/main");
    logs = [];
    const again = await sync(ctx);
    expect(again).toMatchObject({ committed: [], pulled: 0, pushed: false });
    expect(logs.join("\n")).toContain("커밋할 변경 없음");
    expect(logs.join("\n")).toContain("원격과 같음");
  });

  it("origin 이 없으면 커밋만 한다", async () => {
    await git(["remote", "remove", "origin"], shedA);
    const res = await sync(ctxFor(rootA, shedA), { message: "hello" });
    expect(res.pushed).toBe(false);
    expect(await git(["log", "-1", "--format=%s"], shedA)).toBe("hello");
    expect(logs.join("\n")).toContain("origin 이 없어");
  });

  it("다른 기기: clone 한 창고에서 sync 하면 원격 변경을 받고 restore 를 안내한다", async () => {
    await sync(ctxFor(rootA, shedA));
    await git(["clone", "-q", bare, shedB]);
    await git(["config", "user.name", "t"], shedB); await git(["config", "user.email", "t@t"], shedB);
    const ctxB = ctxFor(rootB, shedB);
    await restore(ctxB, "default");
    // A 가 스킬을 고쳐 올린다
    await w(path.join(shedA, "skills/alpha/SKILL.md"), "alpha v2");
    await sync(ctxFor(rootA, shedA));
    logs = [];
    const res = await sync(ctxB);
    expect(res.pulled).toBe(1);
    expect(await r(path.join(shedB, "skills/alpha/SKILL.md"))).toBe("alpha v2");
    expect(logs.join("\n")).toContain("lshed restore");
    // 로컬 B 는 아직 v1 이라 드리프트 → restore 가 맞춘다
    await restore(ctxB, "default");
    expect(await r(path.join(rootB, "skills/alpha/SKILL.md"))).toBe("alpha v2");
  });

  it("저장 안 한 로컬 편집이 있으면 경고하고, dry-run 은 아무것도 안 한다", async () => {
    await w(path.join(rootA, "skills/alpha/SKILL.md"), "edited locally");
    const res = await sync(ctxFor(rootA, shedA), { dryRun: true });
    expect(res.unsaved).toEqual(["skills/alpha"]);
    expect(logs.join("\n")).toContain("lshed save 후 다시 sync");
    expect(await git(["log", "--oneline"], shedA).catch(() => "")).toBe("");
  });

  it("충돌: rebase 를 되돌리고 창고를 깨끗하게 둔다", async () => {
    await sync(ctxFor(rootA, shedA));
    await git(["clone", "-q", bare, shedB]);
    await git(["config", "user.name", "t"], shedB); await git(["config", "user.email", "t@t"], shedB);
    await w(path.join(shedA, "skills/alpha/SKILL.md"), "from A");
    await sync(ctxFor(rootA, shedA));
    await w(path.join(shedB, "skills/alpha/SKILL.md"), "from B");
    await expect(sync(ctxFor(rootB, shedB))).rejects.toThrow(/충돌/);
    expect(await git(["status", "--porcelain"], shedB)).toBe("");
    expect(await r(path.join(shedB, "skills/alpha/SKILL.md"))).toBe("from B"); // 내 커밋은 남아 있다
    expect(await fs.access(path.join(shedB, ".git/rebase-merge")).catch(() => "none")).toBe("none");
  });
});
