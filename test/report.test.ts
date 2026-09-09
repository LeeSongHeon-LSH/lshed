import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectReport, formatReport, issueUrl, openCommands, redact, type Report } from "../src/core/report.js";
import { createAdapter } from "../src/adapters/registry.js";
import { writeState } from "../src/state.js";

const base: Report = {
  lshed: "0.15.5", runtime: "node v22.0.0", os: "linux 6.8.0 x64", agent: "codex", root: "~/.codex", tool: "codex 0.153.4",
  state: { profile: "tools", managed: 7, appliedAt: "2026-09-05T15:51:16.540Z", placement: "links" },
  shed: { path: "~/harness", components: { skills: ["a", "논문리뷰"], mcp: ["exa"] }, packages: ["gstack"], profiles: ["default", "tools"] },
};

describe("redact", () => {
  it("replaces the home directory with ~, in either separator", () => {
    expect(redact("/home/me/.codex and /home/me/harness", "/home/me")).toBe("~/.codex and ~/harness");
    expect(redact("C:\\Users\\me\\.codex or C:/Users/me/harness", "C:\\Users\\me")).toBe("~\\.codex or ~/harness");
  });
  it("leaves paths outside home alone", () => {
    expect(redact("/opt/x /home/other/y", "/home/me")).toBe("/opt/x /home/other/y");
  });
  it("does nothing for a home too short to be a real one", () => {
    expect(redact("/a/b", "/")).toBe("/a/b");
    expect(redact("C:\\x", "C:")).toBe("C:\\x");
  });
});

describe("openCommands", () => {
  const url = "https://github.com/x/y/issues/new?template=bug.yml&title=Run%20'lshed%20init'&report=a%26b";
  it("windows: hands PowerShell a base64 command, so & and % and quotes in the URL are never parsed by a shell", () => {
    const [c] = openCommands(url, "win32");
    expect(c.cmd).toBe("powershell.exe");
    expect(c.args.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand"]);
    const decoded = Buffer.from(c.args[5], "base64").toString("utf16le");
    expect(decoded).toBe("Start-Process -FilePath 'https://github.com/x/y/issues/new?template=bug.yml&title=Run%20''lshed%20init''&report=a%26b'");
    expect(openCommands(url, "win32")).toHaveLength(1);
  });
  it("macOS: open; elsewhere: xdg-open with wslview as the fallback for WSL", () => {
    expect(openCommands(url, "darwin")).toEqual([{ cmd: "open", args: [url] }]);
    expect(openCommands(url, "linux")).toEqual([{ cmd: "xdg-open", args: [url] }, { cmd: "wslview", args: [url] }]);
    expect(openCommands(url, "freebsd")[0].cmd).toBe("xdg-open");
  });
});

describe("formatReport", () => {
  it("names what is in the shed, never its contents, and keeps the status-like layout", () => {
    expect(formatReport(base)).toBe([
      "lshed      0.15.5 (node v22.0.0)",
      "os         linux 6.8.0 x64",
      "agent      codex (~/.codex)",
      "tool       codex 0.153.4",
      "profile    tools, 7 managed paths, links, applied 2026-09-05T15:51:16.540Z",
      "shed       ~/harness",
      "           skills        2: a, 논문리뷰",
      "           mcp           1: exa",
      "           packages      1: gstack",
      "           profiles      default, tools",
    ].join("\n"));
  });
  it("says so when nothing is applied and the shed is unknown; appends command and error", () => {
    const r: Report = { ...base, tool: undefined, state: null, shed: undefined, command: "lshed restore x", error: "Shed location unknown." };
    expect(formatReport(r)).toBe([
      "lshed      0.15.5 (node v22.0.0)",
      "os         linux 6.8.0 x64",
      "agent      codex (~/.codex)",
      "profile    none applied",
      "shed       unknown",
      "command    lshed restore x",
      "error      Shed location unknown.",
    ].join("\n"));
  });
});

describe("issueUrl", () => {
  it("targets the bug form, prefills the report field and titles it with the error", () => {
    const u = issueUrl({ ...base, error: "restore failed: EACCES\nmore" });
    expect(u.startsWith("https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=bug.yml&title=restore%20failed%3A%20EACCES&report=")).toBe(true);
    expect(decodeURIComponent(u.split("&report=")[1])).toBe(formatReport({ ...base, error: "restore failed: EACCES\nmore" }));
  });
  it("drops the report field when the URL would be too long", () => {
    const r: Report = { ...base, shed: { path: "~/s", components: { skills: Array.from({ length: 400 }, (_, i) => `skill-number-${i}`) }, packages: [], profiles: [] } };
    expect(issueUrl(r)).toBe("https://github.com/LeeSongHeon-LSH/lshed/issues/new?template=bug.yml");
  });
});

describe("collectReport", () => {
  it("reads state and manifest, redacts home, and asks the agent's CLI for its version", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-report-"));
    const root = path.join(home, ".codex"), shed = path.join(home, "harness");
    const adapter = createAdapter("codex", root, home);
    await writeState(adapter, { profile: "p", shed, managed: ["a", "b"], appliedAt: "2026-01-01T00:00:00.000Z", link: true });
    await fs.mkdir(shed, { recursive: true });
    await fs.writeFile(path.join(shed, "lshed.yaml"), "version: 1\nagent: codex\ncomponents:\n  skills:\n    - id: s1\n  mcp:\n    - id: exa\nprofiles:\n  p:\n    skills: [s1]\n");
    const asked: string[] = [];
    const r = await collectReport({ version: "1.2.3", adapter, shed, home, command: `lshed --shed ${shed} restore p`, error: `EACCES ${root}/x`, toolVersion: async (b) => { asked.push(b); return "codex-cli 0.1"; } });
    // Windows 는 path.join 이 `\` 를 쓰므로 `~\.codex` 가 된다. 홈이 `~` 로 바뀌었는지가 요점이라 구분자는 맞춰서 본다.
    const fwd = (s?: string) => s?.replace(/\\/g, "/");
    expect(asked).toEqual(["codex"]);
    expect(r.tool).toBe("codex codex-cli 0.1");
    expect(fwd(r.root)).toBe("~/.codex");
    expect(r.state).toEqual({ profile: "p", managed: 2, appliedAt: "2026-01-01T00:00:00.000Z", placement: "links" });
    expect(typeof r.shed === "object" && r.shed && { ...r.shed, path: fwd(r.shed.path) }).toEqual({ path: "~/harness", components: { skills: ["s1"], mcp: ["exa"] }, packages: [], profiles: ["p"] });
    expect(fwd(r.command)).toBe("lshed --shed ~/harness restore p");
    expect(fwd(r.error)).toBe("EACCES ~/.codex/x");
    expect(JSON.stringify(r)).not.toContain(home);
  });
  it("reports a missing CLI and an unreadable shed without throwing", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-report-"));
    const adapter = createAdapter("agy", path.join(home, ".gemini/config"), home);
    const r = await collectReport({ version: "1", adapter, shed: path.join(home, "nope"), home, toolVersion: async () => undefined });
    expect(r.tool).toBe("agy: not found");
    expect(r.state).toBeNull();
    expect(String(r.shed).startsWith("unreadable: ")).toBe(true);
    expect(String(r.shed)).not.toContain(home);
  });
  it("skips the tool line for the shared agents folder", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-report-"));
    const r = await collectReport({ version: "1", adapter: createAdapter("agents", path.join(home, ".agents"), home), home, toolVersion: async () => { throw new Error("must not be called"); } });
    expect(r.tool).toBeUndefined();
    expect(formatReport(r)).toContain("shed       unknown");
  });
});
