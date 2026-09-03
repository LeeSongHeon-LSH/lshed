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
import { exists } from "../src/fsutil.js";
import { git, head } from "../src/git.js";

let tmp: string, remote: string, rootA: string, rootB: string, shed: string, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const ctxFor = (root: string): Ctx => ({ adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} });

/** 가짜 "업스트림": bare 저장소 + 커밋 하나 */
async function makeRemote(): Promise<string> {
  const work = path.join(tmp, "upstream-work");
  await w(path.join(work, "SKILL.md"), "toolkit v1");
  await w(path.join(work, "setup"), "#!/bin/sh\ntouch installed\n");
  await w(path.join(work, "bin/tool"), "#!/bin/sh\necho tool\n");
  await fs.chmod(path.join(work, "setup"), 0o755);
  await git(["init", "-q", "-b", "main"], work);
  await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty-message", "-m", "", "-a"], work).catch(() => {});
  await git(["add", "-A"], work);
  await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "v1"], work);
  const bare = path.join(tmp, "upstream.git");
  await git(["clone", "-q", "--bare", work, bare]);
  return bare;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-pkg-"));
  rootA = path.join(tmp, "A"); rootB = path.join(tmp, "B"); shed = path.join(tmp, "shed"); logs = [];
  remote = await makeRemote();
  // 기기 A: 툴킷을 clone 해서 설치했고, setup 이 스텁 스킬(bin → 툴킷 안) 을 만들어 둔 상태
  await git(["clone", "-q", remote, path.join(rootA, "skills/toolkit")]);
  await w(path.join(rootA, "skills/browse/SKILL.md"), "stub");
  await fs.symlink(path.join(rootA, "skills/toolkit/bin"), path.join(rootA, "skills/browse/bin"), "junction");
  await w(path.join(rootA, "skills/mine/SKILL.md"), "authored");
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("init: 설치한 것 / 생성물 / 내가 쓴 것 을 가른다", () => {
  it("끊어진 링크를 가진 스텁도 패키지 생성물로 본다", async () => {
    await fs.rm(path.join(rootA, "skills/toolkit/bin"), { recursive: true });
    const res = await init(ctxFor(rootA));
    expect(res.generated).toEqual(["skills/browse"]);
  });

  it("clone 은 참조로, 스텁은 건너뛰고, 내 것만 복사한다", async () => {
    const ctx = ctxFor(rootA);
    const res = await init(ctx);
    expect(res.packages).toEqual(["toolkit"]);
    expect(res.generated).toEqual(["skills/browse"]);
    expect(res.manifest.components.skills.map((c) => c.id)).toEqual(["mine"]);
    expect(res.manifest.packages[0]).toMatchObject({ id: "toolkit", into: "skills/toolkit", source: `git:${remote}#main` });
    expect(res.manifest.profiles.default.packages).toEqual(["toolkit"]);
    expect(await exists(path.join(shed, "skills/toolkit"))).toBe(false);
    expect(await exists(path.join(shed, "skills/browse"))).toBe(false);
    const lock = await readLock(shed);
    expect(lock.packages.toolkit.rev).toBe(await head(path.join(rootA, "skills/toolkit")));
    expect(await r(path.join(shed, "lshed.yaml"))).toContain("# install: ./setup");
  });
});

describe("restore: 새 기기에서 패키지를 락 커밋으로 clone", () => {
  beforeEach(async () => {
    await init(ctxFor(rootA));
    // 사용자가 install 명령을 채웠다
    const y = await r(path.join(shed, "lshed.yaml"));
    await fs.writeFile(path.join(shed, "lshed.yaml"), y.replace("    # install: ./setup", "    install: ./setup"));
  });

  it("--yes 없으면 clone 만 하고 install 은 보여주기만", async () => {
    const ctx = ctxFor(rootB);
    const res = await restore(ctx, "default");
    const dir = path.join(rootB, "skills/toolkit");
    expect(await exists(path.join(dir, "SKILL.md"))).toBe(true);
    expect(await head(dir)).toBe((await readLock(shed)).packages.toolkit.rev);
    expect(await exists(path.join(dir, "installed"))).toBe(false);
    expect(logs.join("\n")).toMatch(/설치 명령 1개를 실행하지 않았습니다/);
    expect(res.placed).toEqual(["skills/mine"]);           // 패키지는 관리 집합 밖
    expect(await exists(path.join(rootB, "skills/mine/SKILL.md"))).toBe(true);
  });

  // setup 은 sh 스크립트라 cmd.exe 에서는 못 돈다. install 실행 자체는 플랫폼 셸에 맡긴다.
  it.skipIf(process.platform === "win32")("--yes 면 install 을 실행한다", async () => {
    await restore(ctxFor(rootB), "default", { yes: true });
    expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(true);
  });

  it("이미 있으면 건드리지 않고, --dry-run 은 clone 하지 않는다", async () => {
    await restore(ctxFor(rootB), "default", { dryRun: true });
    expect(await exists(path.join(rootB, "skills/toolkit"))).toBe(false);
    await restore(ctxFor(rootB), "default");
    await w(path.join(rootB, "skills/toolkit/local-edit"), "x");
    await restore(ctxFor(rootB), "default");
    expect(await exists(path.join(rootB, "skills/toolkit/local-edit"))).toBe(true);
  });

  it("status 가 패키지 상태를 보여준다", async () => {
    const ctx = ctxFor(rootB);
    await restore(ctx, "default");
    const s = await status(ctx);
    expect(s.packages).toHaveLength(1);
    expect(s.packages[0].present).toBe(true);
    expect(s.packages[0].rev).toBe(s.packages[0].locked);
  });

  it("락의 커밋으로 맞춘다: 업스트림이 앞서가도 락 커밋을 받는다", async () => {
    const locked = (await readLock(shed)).packages.toolkit.rev;
    const work = path.join(tmp, "upstream-work");
    await w(path.join(work, "SKILL.md"), "toolkit v2");
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "v2"], work);
    await git(["push", "-q", remote, "main"], work);
    await restore(ctxFor(rootB), "default");
    expect(await head(path.join(rootB, "skills/toolkit"))).toBe(locked);
    expect(await r(path.join(rootB, "skills/toolkit/SKILL.md"))).toBe("toolkit v1");
  });
});

describe("update", () => {
  it("원격 최신으로 올리고 락을 갱신하며, --yes 면 install 도 돌린다", async () => {
    await init(ctxFor(rootA));
    const y = await r(path.join(shed, "lshed.yaml"));
    await fs.writeFile(path.join(shed, "lshed.yaml"), y.replace("    # install: ./setup", "    install: ./setup"));
    const ctx = ctxFor(rootB);
    await restore(ctx, "default");
    const before = (await readLock(shed)).packages.toolkit.rev;

    const work = path.join(tmp, "upstream-work");
    await w(path.join(work, "SKILL.md"), "toolkit v2");
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "v2"], work);
    await git(["push", "-q", remote, "main"], work);

    const { parseManifest } = await import("../src/manifest.js");
    const m = parseManifest(await r(path.join(shed, "lshed.yaml")));
    const res = await updatePackages(ctx, m.packages, { yes: true });
    expect(res.lockChanged).toBe(true);
    const after = (await readLock(shed)).packages.toolkit.rev;
    expect(after).not.toBe(before);
    expect(await r(path.join(rootB, "skills/toolkit/SKILL.md"))).toBe("toolkit v2");
    if (process.platform !== "win32") expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(true);
  });
});
