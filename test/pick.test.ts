import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { type Ctx, loadManifest } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { pick, pickGroups, defaultProfileName, type Prompter, type PickGroup } from "../src/core/pick.js";
import { readState } from "../src/state.js";
import { exists } from "../src/fsutil.js";

let tmp: string, root: string, shed: string, ctx: Ctx, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const J = (o: unknown) => JSON.stringify(o, null, 2);

/** 화면마다 고를 id 를 미리 정해 둔 가짜 프롬프트. 본 화면은 seen 에 남긴다. */
function scripted(answers: Record<string, string[] | undefined>, name: string | undefined = "srv", ok = true) {
  const seen: PickGroup[] = [];
  const p: Prompter = {
    async multiselect(g) { seen.push(g); return g.category in answers ? answers[g.category] : []; },
    async text() { return name; },
    async confirm() { return ok; },
  };
  return { p, seen };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-pick-"));
  root = path.join(tmp, "claude"); shed = path.join(tmp, "shed"); logs = [];
  ctx = { adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} };
  await w(path.join(root, "skills/alpha/SKILL.md"), "alpha");
  await w(path.join(root, "skills/beta/SKILL.md"), "beta");
  await w(path.join(root, "agents/rev.md"), "reviewer");
  await w(path.join(root, "CLAUDE.md"), "# rules\n");
  await w(`${root}.json`, J({ mcpServers: { exa: { type: "stdio", command: "x", env: { EXA_API_KEY: "sk-1" } } } }));
  await init(ctx);
  // 손으로 쓴 주석이 살아남는지 보기 위해
  await fs.writeFile(path.join(shed, "lshed.yaml"), (await r(path.join(shed, "lshed.yaml"))).replace("    - id: alpha", "    - id: alpha   # my first skill"));
  // 새 기기처럼: 로컬을 비우고 state 도 없앤다
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(`${root}.json`, { force: true });
  logs = [];
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("pickGroups", () => {
  it("카테고리 순서대로, 비어 있는 카테고리는 빼고 묶는다", async () => {
    const m = await loadManifest(ctx);
    const gs = pickGroups(ctx, m);
    expect(gs.map((g) => g.category)).toEqual(["skills", "agents", "instructions", "mcp"]); // packages·commands·settings 는 없음
    expect(gs[0].options.map((o) => o.id)).toEqual(["alpha", "beta"]);
    expect(gs.every((g) => g.options.every((o) => !o.checked))).toBe(true);
  });

  it("기준 프로필의 항목만 미리 체크한다", async () => {
    const m = await loadManifest(ctx);
    m.profiles.lite = { skills: ["beta"] };
    const gs = pickGroups(ctx, m, m.profiles.lite);
    expect(gs.find((g) => g.category === "skills")!.options.map((o) => o.checked)).toEqual([false, true]);
    expect(gs.find((g) => g.category === "mcp")!.options[0].checked).toBe(false);
  });

  it("기준 프로필이 extends 면 상속받은 것도 체크된다", async () => {
    const m = await loadManifest(ctx);
    m.profiles.lite = { skills: ["beta"] };
    m.profiles.lab = { extends: ["lite"], agents: ["rev"] };
    const { resolveProfile } = await import("../src/manifest.js");
    const gs = pickGroups(ctx, m, resolveProfile(m, "lab"));
    expect(gs.find((g) => g.category === "skills")!.options.map((o) => o.checked)).toEqual([false, true]);
    expect(gs.find((g) => g.category === "agents")!.options[0].checked).toBe(true);
  });

  it("호스트명은 프로필 이름으로 다듬는다", () => {
    expect(defaultProfileName("Lees-MacBook.local")).toBe("lees-macbook.local");
    expect(defaultProfileName("my box!")).toBe("my-box");
    expect(defaultProfileName("")).toBe("picked");
  });
});

describe("lshed restore --pick", () => {
  it("고른 것을 프로필로 저장하고 그 프로필을 적용한다", async () => {
    const { p, seen } = scripted({ skills: ["beta"], instructions: ["main"] });
    const res = await pick(ctx, p);
    expect(seen.map((g) => g.category)).toEqual(["skills", "agents", "instructions", "mcp"]);
    expect(res?.profile).toBe("srv");
    expect(res?.selection).toEqual({ skills: ["beta"], instructions: ["main"] });

    const yaml = await r(path.join(shed, "lshed.yaml"));
    expect(yaml).toContain("# my first skill"); // 주석 보존
    expect(yaml).toContain("  srv:\n    skills:\n      - beta\n    instructions:\n      - main\n");
    const m = await loadManifest(ctx);
    expect(m.profiles.default).toBeDefined(); // 기존 프로필은 그대로

    expect(await exists(path.join(root, "skills/beta/SKILL.md"))).toBe(true);
    expect(await exists(path.join(root, "skills/alpha"))).toBe(false);
    expect(await exists(path.join(root, "agents/rev.md"))).toBe(false);
    expect(await exists(`${root}.json`)).toBe(false); // mcp 를 안 골랐으니 파일도 안 만든다
    expect(await r(path.join(root, "CLAUDE.md"))).toContain("@lshed/instructions/main.md");
    expect((await readState(ctx.adapter))?.profile).toBe("srv");
  });

  it("선택 순서가 아니라 매니페스트 순서로 저장한다 (지침 조각 순서 보존)", async () => {
    const { p } = scripted({ skills: ["beta", "alpha"] });
    const res = await pick(ctx, p);
    expect(res?.selection.skills).toEqual(["alpha", "beta"]);
  });

  it("기준 프로필을 주면 그 항목이 체크된 채 시작하고, 인자 없으면 마지막 적용 프로필이 기준이다", async () => {
    const { p, seen } = scripted({ skills: ["alpha"] }, "lite");
    await pick(ctx, p, { base: "default" });
    expect(seen.find((g) => g.category === "mcp")!.options[0].checked).toBe(true);

    const again = scripted({ skills: ["alpha"] }, "lite2");
    await pick(ctx, again.p);
    expect(logs.join("\n")).toContain("기준 프로필: lite");
    expect(again.seen.find((g) => g.category === "skills")!.options.map((o) => o.checked)).toEqual([true, false]);
    await expect(pick(ctx, p, { base: "nope" })).rejects.toThrow('프로필 "nope" 이 없습니다');
  });

  it("dry-run 은 lshed.yaml 도 로컬도 건드리지 않고 계획만 보여준다", async () => {
    const before = await r(path.join(shed, "lshed.yaml"));
    const { p } = scripted({ skills: ["alpha"], mcp: ["exa"] });
    const res = await pick(ctx, p, { dryRun: true });
    expect(res?.restored?.backupDir).toBeNull();
    expect(await r(path.join(shed, "lshed.yaml"))).toBe(before);
    expect(await exists(root)).toBe(false);
    expect(await readState(ctx.adapter)).toBeNull();
    expect(logs.join("\n")).toContain("(dry-run) 프로필 \"srv\" 은 lshed.yaml 에 쓰지 않았습니다");
    expect(logs.join("\n")).toContain("+ mcp:exa");
  });

  it("이름이 기존 프로필과 같으면 확인을 받고, 거절하면 아무것도 바꾸지 않는다", async () => {
    const before = await r(path.join(shed, "lshed.yaml"));
    const no = scripted({ skills: ["alpha"] }, "default", false);
    expect(await pick(ctx, no.p)).toBeNull();
    expect(await r(path.join(shed, "lshed.yaml"))).toBe(before);
    expect(logs.join("\n")).toContain("취소했습니다");

    const yes = scripted({ skills: ["alpha"] }, "default", true);
    await pick(ctx, yes.p);
    expect((await loadManifest(ctx)).profiles.default).toEqual({ skills: ["alpha"] });
  });

  it("Ctrl+C 로 취소하거나 아무것도 안 고르면 쓰지 않는다", async () => {
    const before = await r(path.join(shed, "lshed.yaml"));
    const cancel = scripted({ skills: undefined });
    expect(await pick(ctx, cancel.p)).toBeNull();
    expect(cancel.seen.length).toBe(1); // 첫 화면에서 멈춤
    const nothing = scripted({});
    expect(await pick(ctx, nothing.p)).toBeNull();
    expect(logs.join("\n")).toContain("아무것도 고르지 않았습니다");
    expect(await r(path.join(shed, "lshed.yaml"))).toBe(before);
    expect(await readState(ctx.adapter)).toBeNull();
  });

  it("--name 으로 이름을 주면 묻지 않고, 나쁜 이름은 거절한다", async () => {
    const { p } = scripted({ skills: ["alpha"] }, undefined);
    const res = await pick(ctx, p, { name: "box-1" });
    expect(res?.profile).toBe("box-1");
    await expect(pick(ctx, scripted({ skills: ["alpha"] }).p, { name: "a b" })).rejects.toThrow("영문·숫자·._- 만");
  });
});
