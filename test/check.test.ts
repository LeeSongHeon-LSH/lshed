import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, formatCheck, askCommand, askersOf, installed, skillsDirOf, ask, CHECK_PROMPT, type Answer } from "../src/core/check.js";
import { createAdapter } from "../src/adapters/registry.js";

const tmpHome = () => fs.mkdtemp(path.join(os.tmpdir(), "lshed-check-t-"));
const answer = (out: string, extra: Partial<Answer> = {}): Answer => ({ out, err: "", code: 0, timedOut: false, ...extra });

describe("check", () => {
  it("places a skill with the passphrase, asks the agent's CLI with a fixed prompt from an empty cwd, and removes the skill", async () => {
    const home = await tmpHome();
    const adapter = createAdapter("codex", path.join(home, ".codex"), home);
    const seen: { cli: string; prompt: string; skill: string; cwdEmpty: boolean }[] = [];
    const r = await check(adapter, {
      passphrase: "check-abc",
      installed: async () => true,
      ask: async (cli, prompt, o) => {
        const skill = await fs.readFile(path.join(home, ".agents/skills/lshed-check/SKILL.md"), "utf8");
        seen.push({ cli, prompt, skill, cwdEmpty: (await fs.readdir(o.cwd)).length === 0 });
        return answer("Sure — the passphrase is check-abc.");
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].cli).toBe("codex");
    expect(seen[0].prompt).toBe(CHECK_PROMPT);
    expect(seen[0].skill).toContain("name: lshed-check");
    expect(seen[0].skill).toContain("check-abc");
    expect(seen[0].cwdEmpty).toBe(true);
    expect(r.results).toEqual([{ cli: "codex", status: "read", attempts: [expect.objectContaining({ out: expect.stringContaining("check-abc") })] }]);
    expect(r.skillsDir).toBe(path.join(home, ".agents", "skills"));
    await expect(fs.access(path.join(home, ".agents/skills/lshed-check"))).rejects.toThrow();
  });

  it("asks again when the first answer misses, gives up after the attempt budget, and still cleans up", async () => {
    const home = await tmpHome();
    const adapter = createAdapter("agy", path.join(home, ".gemini/config"), home);
    let n = 0;
    const r = await check(adapter, { attempts: 2, passphrase: "check-xyz", installed: async () => true, ask: async () => answer(`nope ${++n}`, { code: 1, err: "banner\n401 Unauthorized" }) });
    expect(n).toBe(2);
    expect(r.results[0]).toMatchObject({ cli: "agy", status: "not-read" });
    expect(r.results[0].attempts).toHaveLength(2);
    await expect(fs.access(path.join(home, ".gemini/config/skills/lshed-check"))).rejects.toThrow();
  });

  it("does not touch an existing lshed-check skill", async () => {
    const home = await tmpHome();
    const adapter = createAdapter("codex", path.join(home, ".codex"), home);
    const dir = path.join(home, ".agents/skills/lshed-check");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), "theirs");
    await expect(check(adapter, { installed: async () => true, ask: async () => answer("x") })).rejects.toThrow(/already exists/);
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("theirs");
  });

  it("agents: asks every installed CLI and reports the missing ones without calling them", async () => {
    const home = await tmpHome();
    const adapter = createAdapter("agents", path.join(home, ".agents"), home);
    const asked: string[] = [];
    const r = await check(adapter, { attempts: 1, passphrase: "check-1", installed: async (cli) => cli === "codex" || cli === "agent", ask: async (cli) => { asked.push(cli); return answer(cli === "codex" ? "check-1" : "dunno"); } });
    expect(asked).toEqual(["codex", "agent"]);
    expect(r.results.map((c) => `${c.cli}:${c.status}`)).toEqual(["codex:read", "gemini:not-installed", "copilot:not-installed", "agent:not-read"]);
  });
});

describe("formatCheck", () => {
  it("one line per CLI; failures show each attempt, the end of stderr, and point at report", () => {
    const out = formatCheck({
      agent: "agents", skillsDir: "/home/me/.agents/skills", passphrase: "check-1", leftovers: [],
      results: [
        { cli: "codex", status: "read", attempts: [answer("check-1")] },
        { cli: "gemini", status: "not-installed", attempts: [] },
        { cli: "agent", status: "not-read", attempts: [answer("", { code: 1, err: `${"banner ".repeat(60)}401 Unauthorized: invalid key` }), answer("I cannot find that skill", { timedOut: true, code: null })] },
      ],
    }, (s) => s.replace("/home/me", "~"));
    expect(out).toBe([
      "check      agents: skill placed in ~/.agents/skills, asked for its passphrase, removed",
      "  ✔ codex read the skill  (attempt 1)",
      "  · gemini: not installed here, nothing to ask",
      "  ✘ agent did not answer with the passphrase in 2 attempts",
      "      attempt 1: (exit 1) (no output)",
      `        stderr: …${`${"banner ".repeat(60)}401 Unauthorized: invalid key`.trim().slice(-200)}`,
      "      attempt 2: (timed out) I cannot find that skill",
      "    If lshed placed the file where agent should read it, this is worth reporting: lshed report",
    ].join("\n"));
  });

  // Windows 6차: 죽은 CLI 의 자식이 작업 폴더를 쥐고 있으면 rmdir 가 EBUSY 로 막힌다.
  // 그 실패가 검사 결과를 덮으면 안 되고, 무엇이 남았는지는 말해 주어야 한다.
  it("치우지 못한 것은 결과를 덮지 않고 끝에 한 줄로 붙는다", () => {
    const out = formatCheck({
      agent: "claude-code", skillsDir: "/home/me/.claude/skills", passphrase: "check-1",
      results: [{ cli: "claude", status: "not-read", attempts: [answer("", { timedOut: true, code: null })] }],
      leftovers: ["/tmp/lshed-check-j5Xap3", "/home/me/.claude/skills/lshed-check"],
    }, (s) => s.replace("/home/me", "~"));
    expect(out).toContain("      attempt 1: (timed out) (no output)");   // 결과가 살아 있다
    expect(out).toContain("  ! could not remove /tmp/lshed-check-j5Xap3 — something still has it open. Remove it yourself.");
    expect(out).toContain("  ! could not remove ~/.claude/skills/lshed-check — something still has it open. The next check will refuse to start until it is gone. Remove it yourself.");
  });
});

// 정리가 실패해도 check() 는 결과를 돌려준다. 예전에는 finally 의 rm 이 던져 (timed out) 도 답 발췌도
// 사라지고 EBUSY 메시지만 남았다 (Windows 6차 검증). 여기서는 상위 폴더의 쓰기 권한을 뺏어 같은 상황을 만든다.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)("정리가 막혀도 결과는 살아 있다", () => {
  it("지우지 못한 스킬 폴더는 leftovers 로 알리고, 검사 결과는 그대로 돌아온다", async () => {
    const home = await tmpHome();
    const adapter = createAdapter("claude-code", path.join(home, ".claude"));
    const skills = path.join(home, ".claude", "skills");
    await fs.mkdir(skills, { recursive: true });
    let r;
    try {
      r = await check(adapter, {
        attempts: 1, passphrase: "check-1", installed: async () => true,
        ask: async () => { await fs.chmod(skills, 0o500); return answer("nope"); },   // 답한 직후 폴더를 잠근다
      });
    } finally {
      await fs.chmod(skills, 0o700);
    }
    expect(r.results[0].status).toBe("not-read");            // 결과가 살아 있다
    expect(r.leftovers).toEqual([path.join(skills, "lshed-check")]);
    expect(formatCheck(r)).toContain("The next check will refuse to start until it is gone.");
    await fs.rm(path.join(skills, "lshed-check"), { recursive: true, force: true });
  });
});

describe("plumbing", () => {
  it("askers and commands mirror scripts/vm/probe.sh", () => {
    expect(askersOf("cursor")).toEqual(["agent"]);
    expect(askersOf("agents")).toEqual(["codex", "gemini", "copilot", "agent"]);
    expect(askCommand("codex", "p")).toEqual({ cmd: "codex", args: ["exec", "--skip-git-repo-check", "--ephemeral", "p"] });
    expect(askCommand("gemini", "p")).toMatchObject({ json: true, env: { GEMINI_CLI_TRUST_WORKSPACE: "true" } });
    expect(() => askCommand("nope", "p")).toThrow();
  });
  it("installed(): looks along PATH, with PATHEXT on Windows", async () => {
    const d = await tmpHome();
    await fs.writeFile(path.join(d, "codex.cmd"), "");
    await fs.writeFile(path.join(d, "agy"), "");
    // 여기서 흉내 내는 플랫폼의 구분자로 이어 붙인다 — Windows 러너의 임시 경로에는 `:` 가 들어 있어 linux 흉내에 `:` 를 쓰면 잘린다
    expect(await installed("codex", { PATH: `C:\\nowhere;${d}`, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(true);
    expect(await installed("agy", { PATH: `C:\\nowhere;${d}`, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(false);   // 확장자 없는 파일은 Windows 에선 실행파일이 아니다
    if (process.platform !== "win32") {   // Windows 의 임시 경로(`C:\…`)는 `:` 로 나뉘는 linux PATH 에 넣을 수 없다
      expect(await installed("codex", { PATH: d }, "linux")).toBe(false);   // .cmd 는 Linux 에서 codex 가 아니다
      expect(await installed("agy", { PATH: d }, "linux")).toBe(true);
      expect(await installed("gemini", { PATH: d }, "linux")).toBe(false);
    }
  });
  it("skillsDirOf: the adapter's skills category, absolute", () => {
    expect(skillsDirOf(createAdapter("claude-code", "/r"))).toBe(path.join("/r", "skills"));
    expect(skillsDirOf(createAdapter("codex", "/h/.codex", "/h"))).toBe(path.join("/h", ".agents", "skills"));
  });
});

// ask() 는 'close' 를 기다리는데, 'close' 는 파이프가 모두 닫혀야 온다. 자식이 남기고 간 손자가 그 파이프를
// 쥐고 있거나 CLI 가 종료 신호를 무시하면 'close' 는 오지 않는다 — Windows 의 kill() 은 cmd.exe 하나만
// 끝내므로 늘 걸릴 수 있는 자리였다. 멈추면 check() 의 정리도 돌지 않아 다음 실행까지 막힌다.
describe.skipIf(process.platform === "win32")("ask 는 어떤 경우에도 답을 돌려준다", () => {
  /** PATH 앞에 놓을 가짜 CLI. 이름은 askersOf 가 아는 것이어야 한다 */
  async function fakeCli(name: string, body: string): Promise<string> {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-fakecli-"));
    const f = path.join(d, name);
    await fs.writeFile(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return d;
  }
  const withPath = async <T>(d: string, fn: () => Promise<T>): Promise<T> => {
    const old = process.env.PATH;
    process.env.PATH = `${d}:${old}`;
    try { return await fn(); } finally { process.env.PATH = old; }
  };

  it("자식이 끝난 뒤 손자가 파이프를 쥐고 있어도 유예 시간 뒤에 끝난다", async () => {
    // 손자(sleep)가 stdout 을 물려받은 채 산다 → 'exit' 은 오지만 'close' 는 오지 않는다
    const d = await fakeCli("codex", 'sleep 30 &\necho "the passphrase"\nexit 0');
    const t0 = Date.now();
    const a = await withPath(d, () => ask("codex", "p", { cwd: d, timeoutMs: 60_000, graceMs: 150 }));
    expect(a.out).toContain("the passphrase");   // 죽기 전에 낸 출력은 잃지 않는다
    expect(a.timedOut).toBe(false);
    expect(Date.now() - t0).toBeLessThan(10_000);   // 손자의 30초를 기다리지 않는다
  });

  it("종료 신호를 무시하는 CLI 도 --timeout 뒤에 끝난다", async () => {
    const d = await fakeCli("codex", "trap '' TERM\nsleep 30");
    const t0 = Date.now();
    const a = await withPath(d, () => ask("codex", "p", { cwd: d, timeoutMs: 200, graceMs: 150 }));
    expect(a.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
