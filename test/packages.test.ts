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
import { git, head, lsRemote } from "../src/git.js";
import { readState } from "../src/state.js";

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
    expect(logs.join("\n")).toMatch(/1 install command was not run/);
    expect(res.placed).toEqual(["skills/mine"]);           // 패키지는 관리 집합 밖
    expect(await exists(path.join(rootB, "skills/mine/SKILL.md"))).toBe(true);
  });

  // setup 은 sh 스크립트라 cmd.exe 에서는 못 돈다. install 실행 자체는 플랫폼 셸에 맡긴다.
  it.skipIf(process.platform === "win32")("--yes 면 install 을 실행한다", async () => {
    await restore(ctxFor(rootB), "default", { yes: true });
    expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(true);
  });

  // 첫 restore 가 "rerun with '--yes'" 라고 안내하므로, 이미 clone 된 패키지에도 --yes 는 install 을 돌려야 한다
  it.skipIf(process.platform === "win32")("이미 있는 패키지에도 --yes 면 install 을 다시 돌린다", async () => {
    await restore(ctxFor(rootB), "default");
    const marker = path.join(rootB, "skills/toolkit/installed");
    expect(await exists(marker)).toBe(false);
    await restore(ctxFor(rootB), "default", { yes: true, dryRun: true });
    expect(await exists(marker)).toBe(false);
    logs.length = 0;
    await restore(ctxFor(rootB), "default", { yes: true });
    expect(await exists(marker)).toBe(true);
    expect(logs.join("\n")).toMatch(/= package toolkit\n {2}\$ \(skills\/toolkit\) \.\/setup/);
    expect(logs.join("\n")).not.toMatch(/was not run/);
  });

  // Windows 5차 검증: gstack 의 ./setup 이 cmd.exe 에서 죽자 부품 아홉이 하나도 안 놓이고 프로필도 안 남았다.
  // `exit 3` 은 sh 와 cmd.exe 양쪽에서 같은 뜻이라 세 OS 에서 같은 시험이 된다.
  it("--yes 의 install 이 실패해도 나머지는 놓이고 상태가 남으며, 실패는 끝에 모아 알린다", async () => {
    const y = await r(path.join(shed, "lshed.yaml"));
    await fs.writeFile(path.join(shed, "lshed.yaml"), y.replace("    install: ./setup", "    install: exit 3"));
    const ctx = ctxFor(rootB);
    const res = await restore(ctx, "default", { yes: true });
    expect(res.failedInstalls).toEqual(["toolkit"]);
    expect(res.placed).toEqual(["skills/mine"]);
    expect(await exists(path.join(rootB, "skills/mine/SKILL.md"))).toBe(true);
    expect(await exists(path.join(rootB, "skills/toolkit/SKILL.md"))).toBe(true);
    expect((await readState(ctx.adapter))?.profile).toBe("default");
    const log = logs.join("\n");
    expect(log).toMatch(/\$ \(skills\/toolkit\) exit 3\n {4}! install failed: command exited with 3: exit 3/);
    expect(log).toMatch(/Profile "default" applied: placed 1[\s\S]*1 install command failed\. Everything else was placed\.[\s\S]*cd .*skills[\\/]toolkit && exit 3[\s\S]*lshed report/);
    expect(log).not.toMatch(/was not run/);
  });

  it("이미 있으면 건드리지 않고, --dry-run 은 clone 하지 않는다", async () => {
    await restore(ctxFor(rootB), "default", { dryRun: true });
    expect(await exists(path.join(rootB, "skills/toolkit"))).toBe(false);
    // clone 은 안 하지만 기다리는 install 명령은 보여 준다 (Windows 실기기 검증에서 빠져 있던 것)
    expect(logs.join("\n")).toMatch(/1 install command was not run[\s\S]*cd .*skills[\\/]toolkit && \.\/setup/);
    expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(false);
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
  it("--dry-run: 업스트림을 읽기만 해서 = / ~ 이전 → 최신 을 찍고 clone 과 락은 그대로", async () => {
    await init(ctxFor(rootA));
    const ctx = ctxFor(rootB);
    await restore(ctx, "default");
    const { parseManifest } = await import("../src/manifest.js");
    const m = parseManifest(await r(path.join(shed, "lshed.yaml")));
    const before = await head(path.join(rootB, "skills/toolkit"));

    logs = [];
    let res = await updatePackages(ctx, m.packages, { dryRun: true });
    expect(res.lockChanged).toBe(false);
    expect(logs).toEqual([`  = package toolkit  ${before.slice(0, 7)} (latest)`]);

    const work = path.join(tmp, "upstream-work");
    await w(path.join(work, "SKILL.md"), "toolkit v2");
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "v2"], work);
    await git(["push", "-q", remote, "main"], work);
    const tip = await head(work);

    logs = [];
    res = await updatePackages(ctx, m.packages, { dryRun: true });
    expect(res.lockChanged).toBe(false);
    expect(logs).toEqual([`  ~ package toolkit  ${before.slice(0, 7)} → ${tip.slice(0, 7)}`]);
    expect(await head(path.join(rootB, "skills/toolkit"))).toBe(before);           // 옮기지 않았다
    expect((await readLock(shed)).packages.toolkit.rev).toBe(before);              // 락도 그대로
    expect(await r(path.join(rootB, "skills/toolkit/SKILL.md"))).toBe("toolkit v1");
  });

  it("--dry-run: 업스트림에 닿지 못하면 ? 로 알리고 멈추지 않는다", async () => {
    await init(ctxFor(rootA));
    const ctx = ctxFor(rootB);
    await restore(ctx, "default");
    await fs.rm(remote, { recursive: true, force: true });                          // 원격이 사라졌다
    const { parseManifest } = await import("../src/manifest.js");
    const m = parseManifest(await r(path.join(shed, "lshed.yaml")));
    logs = [];
    await updatePackages(ctx, m.packages, { dryRun: true });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^ {2}\? package toolkit {2}\(upstream lookup failed: /);
  });

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
    const res = await updatePackages(ctx, m.packages, { yes: process.platform !== "win32" });
    expect(res.lockChanged).toBe(true);
    const after = (await readLock(shed)).packages.toolkit.rev;
    expect(after).not.toBe(before);
    expect(await r(path.join(rootB, "skills/toolkit/SKILL.md"))).toBe("toolkit v2");
    if (process.platform !== "win32") expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(true);

    // 최신이어도 --yes 면 install 을 돌린다
    if (process.platform !== "win32") {
      await fs.rm(path.join(rootB, "skills/toolkit/installed"));
      const again = await updatePackages(ctx, m.packages, { yes: true });
      expect(again.lockChanged).toBe(false);
      expect(await exists(path.join(rootB, "skills/toolkit/installed"))).toBe(true);
    }
  });
});

describe("lsRemote", () => {
  it("브랜치·태그·HEAD 를 clone 없이 읽고, 같은 이름이면 브랜치가 이긴다", async () => {
    const work = path.join(tmp, "upstream-work");
    const main = await head(work);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "tag", "-a", "v1", "-m", "v1"], work);                             // 주석 태그: 가리키는 커밋으로 풀린다
    await git(["checkout", "-q", "-b", "v1-branch"], work);
    await w(path.join(work, "SKILL.md"), "on branch");
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-am", "branch"], work);
    const onBranch = await head(work);
    await git(["branch", "-q", "-f", "both", onBranch], work);
    await git(["tag", "-f", "both", main], work);                                  // 브랜치 both ≠ 태그 both
    await git(["push", "-q", "-f", "--all", remote], work);
    await git(["push", "-q", "-f", "--tags", remote], work);

    expect(await lsRemote(remote)).toBe(main);                                     // HEAD (main)
    expect(await lsRemote(remote, "main")).toBe(main);
    expect(await lsRemote(remote, "v1")).toBe(main);                               // 주석 태그 → 커밋
    expect(await lsRemote(remote, "both")).toBe(onBranch);                         // 브랜치 우선
    await expect(lsRemote(remote, "nope")).rejects.toThrow(/has no nope/);
  });
});
