import { describe, it, expect } from "vitest";
import { formatStatus, type Status } from "../src/core/status.js";
import type { Package } from "../src/manifest.js";

const pkg = (id: string): Package => ({ id, source: `git:https://x/${id}` }) as Package;
const state = { profile: "default", shed: "/s", appliedAt: "2026-09-08T00:00:00.000Z", managed: ["a", "b"], link: false } as Status["state"];

describe("formatStatus", () => {
  // 0.17.2 의 구멍: install: 이 죽어도 패키지는 제자리에 있으므로 status 가 멀쩡한 기기와 구별하지 못했다.
  it("마지막 restore 에서 죽은 install: 은 그 패키지 밑에 한 줄로 남는다", () => {
    const s: Status = {
      state: { ...state!, failedInstalls: ["gstack"] }, drifted: [], missingEnv: [], fresh: [],
      packages: [{ pkg: pkg("gstack"), present: true, rev: "a".repeat(40), locked: "a".repeat(40) }],
    };
    const out = formatStatus(s, "/root");
    expect(out).toContain("packages   1 in sync: gstack");
    expect(out).toContain("           ! gstack  install: failed at the last restore  → fix it, then lshed restore default --yes");
  });
  it("실패가 없으면 그 줄은 나오지 않는다", () => {
    const s: Status = { state, drifted: [], missingEnv: [], fresh: [], packages: [{ pkg: pkg("gstack"), present: true, rev: "a", locked: "a" }] };
    expect(formatStatus(s, "/root")).not.toContain("install: failed");
  });

  it("no state: says so and names the two ways in", () => {
    const out = formatStatus({ state: null, drifted: [], packages: [], missingEnv: [], fresh: [] }, "/root", "codex");
    expect(out).toBe("No profile applied (codex: /root).\n  lshed init --shed <dir>   or   lshed restore <profile>");
  });

  it("all clear: every row is present, packages on one line", () => {
    const s: Status = {
      state, drifted: [], missingEnv: [], fresh: [],
      packages: [{ pkg: pkg("gstack"), present: true, rev: "a".repeat(40), locked: "a".repeat(40) }, { pkg: pkg("exa"), present: true, rev: "3.4.1", locked: "3.4.1" }],
    };
    expect(formatStatus(s, "/root")).toBe([
      "profile    default",
      "shed       /s",
      "applied    2026-09-08T00:00:00.000Z",
      "managed    2 paths (claude-code: /root)",
      "placement  copies",
      "",
      "drift      none",
      "packages   2 in sync: gstack, exa",
      "env        all set",
      "outside    none",
    ].join("\n"));
  });

  it("problems: only the odd packages get their own line, each with the next command", () => {
    const s: Status = {
      state: { ...state!, link: true },
      drifted: ["skills/alpha", "mcp/foo"],
      packages: [
        { pkg: pkg("ok"), present: true, rev: "1", locked: "1" },
        { pkg: pkg("gstack"), present: true, rev: "b".repeat(40), locked: "c".repeat(40) },
        { pkg: pkg("exa"), present: false, locked: "3.4.1" },
        { pkg: pkg("loose"), present: true, rev: "9" },
      ],
      missingEnv: [{ rel: "mcp:exa", vars: ["EXA_API_KEY"] }, { rel: "mcp:notion", vars: ["NOTION_TOKEN", "NOTION_ORG"] }],
      fresh: ["skills/gamma"],
    };
    expect(formatStatus(s, "/root").split("\n").slice(4)).toEqual([
      "placement  links (file parts point into the shed; edits land there directly)",
      "",
      "drift      2: skills/alpha, mcp/foo  → lshed diff",
      "packages   1 of 4 in sync: ok",
      "           ! gstack  bbbbbbb ≠ lock ccccccc  → lshed update",
      "           ! exa     not installed  → lshed restore",
      "           ! loose   9 (not in lock)",
      "env        3 not set",
      "           ! mcp:exa     EXA_API_KEY  → export in your shell",
      "           ! mcp:notion  NOTION_TOKEN, NOTION_ORG  → export in your shell",
      "outside    1: skills/gamma  → lshed add",
    ]);
  });

  it("no package in sync: the count still says of how many", () => {
    const s: Status = { state, drifted: [], missingEnv: [], fresh: [], packages: [{ pkg: pkg("exa"), present: false }] };
    expect(formatStatus(s, "/root")).toContain("packages   0 of 1 in sync\n           ! exa  not installed  → lshed restore");
  });
});
