import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { check, formatCheck, askCommand, askersOf, installed, skillsDirOf, CHECK_PROMPT, type Answer } from "../src/core/check.js";
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
      agent: "agents", skillsDir: "/home/me/.agents/skills", passphrase: "check-1",
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
    expect(await installed("codex", { PATH: d, PATHEXT: ".EXE;.CMD" }, "win32")).toBe(true);
    expect(await installed("codex", { PATH: d }, "linux")).toBe(false);
    expect(await installed("agy", { PATH: `/nowhere:${d}` }, "linux")).toBe(true);
    expect(await installed("gemini", { PATH: d }, "linux")).toBe(false);
  });
  it("skillsDirOf: the adapter's skills category, absolute", () => {
    expect(skillsDirOf(createAdapter("claude-code", "/r"))).toBe(path.join("/r", "skills"));
    expect(skillsDirOf(createAdapter("codex", "/h/.codex", "/h"))).toBe(path.join("/h", ".agents", "skills"));
  });
});
