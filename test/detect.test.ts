import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agentsHere, agentByState, missingRootMessage, type AgentHere } from "../src/core/detect.js";
import { createAdapter } from "../src/adapters/registry.js";
import { writeState } from "../src/state.js";

const DIR: Record<string, string> = { "claude-code": ".claude", codex: ".codex", gemini: ".gemini", copilot: ".copilot", cursor: ".cursor", agy: ".gemini/config", agents: ".agents" };
const fakeHome = async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-detect-"));
  return { home, make: (n: string) => createAdapter(n, path.join(home, DIR[n]), home) };
};
const st = { profile: "p", shed: "/s", managed: [], appliedAt: "2026-01-01T00:00:00.000Z" };

describe("agentsHere / agentByState", () => {
  it("no state anywhere → undefined, so the default agent stays", async () => {
    const { make } = await fakeHome();
    const list = await agentsHere(make);
    expect(list.map((a) => a.name)).toEqual(["claude-code", "codex", "gemini", "copilot", "cursor", "agy", "agents"]);
    expect(list.every((a) => !a.exists && !a.hasState)).toBe(true);
    expect(agentByState(list)).toBeUndefined();
  });
  it("only codex has state → codex; claude-code with state always wins", async () => {
    const { home, make } = await fakeHome();
    await writeState(make("codex"), st);
    expect(agentByState(await agentsHere(make))).toBe("codex");
    await writeState(make("claude-code"), st);
    const list = await agentsHere(make);
    expect(list.find((a) => a.name === "codex")).toMatchObject({ root: path.join(home, ".codex"), exists: true, hasState: true });
    expect(agentByState(list)).toBe("claude-code");
  });
  it("two non-default agents with state → asks for --agent", async () => {
    const { make } = await fakeHome();
    await writeState(make("codex"), st);
    await writeState(make("agy"), st);
    expect(() => agentByState([])).not.toThrow();
    await expect(agentsHere(make).then(agentByState)).rejects.toThrow(/codex, agy.*--agent/);
  });
});

describe("missingRootMessage", () => {
  const mk = (name: string, exists: boolean): AgentHere => ({ name, root: `/h/${name}`, exists, hasState: false });
  it("names the roots that do exist and suggests the first", () => {
    const m = missingRootMessage(mk("claude-code", false), [mk("claude-code", false), mk("codex", true), mk("agents", true)]);
    expect(m).toBe("claude-code's config root does not exist: /h/claude-code\n  Found here: codex (/h/codex), agents (/h/agents).  Try: lshed init --agent codex");
  });
  it("with nothing found, lists the agent names", () => {
    expect(missingRootMessage(mk("codex", false), [mk("codex", false)])).toContain("--agent <claude-code|codex|gemini|copilot|cursor|agy|agents>");
  });
});
