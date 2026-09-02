import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { listRows } from "../src/core/list.js";
import { remove, prune } from "../src/core/remove.js";
import { exists } from "../src/fsutil.js";

let tmp: string, root: string, shed: string, ctx: Ctx, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-rm-"));
  root = path.join(tmp, "claude"); shed = path.join(tmp, "shed"); logs = [];
  ctx = { adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l) };
  await w(path.join(root, "skills/alpha/SKILL.md"), "a");
  await w(path.join(root, "skills/beta/SKILL.md"), "b");
  await w(path.join(root, "agents/beta.md"), "agent beta");
  await init(ctx);
  // beta 스킬은 어떤 프로필도 안 쓰게 만든다 + 패키지 하나 추가
  const y = (await r(path.join(shed, "lshed.yaml")))
    .replace("      - beta\n", "")
    .replace("profiles:", "packages:\n  - id: tk\n    source: github:x/y@main\n    into: skills/tk\n    # keep this comment\nprofiles:");
  await fs.writeFile(path.join(shed, "lshed.yaml"), y);
  await fs.writeFile(path.join(shed, "lshed.lock"), "version: 1\npackages:\n  tk:\n    source: github:x/y@main\n    commit: abc\n");
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("list", () => {
  it("누가 쓰는지 보여주고 미사용을 가려낸다", async () => {
    const { loadManifest } = await import("../src/core/context.js");
    const rows = listRows(await loadManifest(ctx));
    expect(rows.find((x) => x.category === "skills" && x.id === "alpha")?.usedBy).toEqual(["default"]);
    expect(rows.filter((x) => !x.usedBy.length).map((x) => `${x.category}/${x.id}`).sort()).toEqual(["packages/tk", "skills/beta"]);
  });
});

describe("remove", () => {
  it("프로필이 쓰는 것은 거부", async () => {
    await expect(remove(ctx, "alpha")).rejects.toThrow(/프로필 default 이 쓰고/);
  });
  it("모호한 id 는 거부, category/id 로는 된다", async () => {
    await expect(remove(ctx, "beta")).rejects.toThrow(/모호/);
    const res = await remove(ctx, "skills/beta");
    expect(res.deleted).toBe(path.join(shed, "skills/beta"));
    expect(await exists(path.join(shed, "skills/beta"))).toBe(false);
    const y = await r(path.join(shed, "lshed.yaml"));
    const { parseManifest } = await import("../src/manifest.js");
    const m = parseManifest(y);
    expect(m.components.skills.map((c) => c.id)).toEqual(["alpha"]);   // 스킬 beta 만 사라지고
    expect(m.components.agents.map((c) => c.id)).toEqual(["beta"]);    // 에이전트 beta 는 남는다
    expect(y).toContain("# keep this comment");            // 주석 보존
    expect(y).toContain("# lshed manifest");                // 헤더 보존
  });
  it("패키지는 매니페스트·락에서만 빠진다", async () => {
    await remove(ctx, "tk");
    const y = await r(path.join(shed, "lshed.yaml"));
    expect(y).not.toContain("id: tk");
    expect(y).not.toContain("packages:");
    expect(await r(path.join(shed, "lshed.lock"))).not.toContain("tk");
  });
  it("없는 것", async () => {
    await expect(remove(ctx, "nope")).rejects.toThrow(/창고에 없습니다/);
  });
});

describe("prune", () => {
  it("--yes 없으면 목록만", async () => {
    expect(await prune(ctx)).toEqual([]);
    expect(await exists(path.join(shed, "skills/beta"))).toBe(true);
    expect(logs.join("\n")).toMatch(/미사용 2개/);
  });
  it("--yes 면 전부 제거", async () => {
    expect((await prune(ctx, { yes: true })).sort()).toEqual(["packages/tk", "skills/beta"]);
    expect(await exists(path.join(shed, "skills/beta"))).toBe(false);
    const { loadManifest } = await import("../src/core/context.js");
    expect(listRows(await loadManifest(ctx)).filter((x) => !x.usedBy.length)).toEqual([]);
  });
});
