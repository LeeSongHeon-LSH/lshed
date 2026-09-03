import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { restore } from "../src/core/restore.js";
import { diff } from "../src/core/diff.js";
import { save } from "../src/core/save.js";
import { status } from "../src/core/status.js";
import { add } from "../src/core/add.js";
import { readState } from "../src/state.js";
import { mask, portable, expand, envWithHome } from "../src/core/entries.js";

let tmp: string, rootA: string, rootB: string, shed: string, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const rj = async (p: string) => JSON.parse(await fs.readFile(p, "utf8"));
const J = (o: unknown) => JSON.stringify(o, null, 2);
const ctxFor = (root: string): Ctx => ({ adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} });
const HOME = os.homedir();

const hooks = { Stop: [{ hooks: [{ type: "command", command: `${HOME}/.claude/hooks/notify.sh`, timeout: 5 }] }] };
const permissions = { allow: ["Bash(npm test)", "Read"], deny: ["Bash(rm -rf *)"] };
const env = { ANTHROPIC_API_KEY: "sk-ant-secret", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8000" };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-set-"));
  rootA = path.join(tmp, "A"); rootB = path.join(tmp, "B"); shed = path.join(tmp, "shed"); logs = [];
  await w(path.join(rootA, "skills/mine/SKILL.md"), "authored");
  await w(path.join(rootA, "settings.json"), J({ model: "opus", theme: "dark", hooks, permissions, env, enabledPlugins: { "exa@official": true } }));
  delete process.env.ANTHROPIC_API_KEY;
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("entries: settings 용 순수 로직", () => {
  it("portable: 홈 경로만 ${HOME} 으로", () => {
    expect(portable({ a: "/home/me/.claude/x", b: "/home/meow/x", c: "/home/me" }, "/home/me")).toEqual({ a: "${HOME}/.claude/x", b: "/home/meow/x", c: "${HOME}" });
    expect(expand(portable(hooks, HOME), envWithHome({})).value).toEqual(hooks);
  });
  it("mask: secretRootIds 인 항목은 자기 자신이 시크릿 맵", () => {
    const cat = { secretKeys: [], secretRootIds: ["env"] };
    expect(mask("env", env, cat)).toEqual({ ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8000" });
    expect(mask("permissions", permissions, cat)).toEqual(permissions);
  });
});

describe("settings: 키 하나가 항목 하나", () => {
  it("init: enabledPlugins 는 건너뛰고, 홈 경로와 시크릿은 자리표시자로", async () => {
    const ctx = ctxFor(rootA);
    const { manifest } = await init(ctx);
    expect(manifest.components.settings?.map((c) => c.id)).toEqual(["env", "hooks", "model", "permissions", "theme"]);
    expect(await rj(path.join(shed, "settings/hooks.json"))).toEqual({ Stop: [{ hooks: [{ type: "command", command: "${HOME}/.claude/hooks/notify.sh", timeout: 5 }] }] });
    expect(await rj(path.join(shed, "settings/env.json"))).toEqual({ ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8000" });
    expect(await fs.readFile(path.join(shed, "settings/env.json"), "utf8")).not.toContain("sk-ant");
    expect((await readState(ctx.adapter))?.managed).toEqual(expect.arrayContaining(["settings:hooks", "settings:env", "settings:model"]));
    expect((await status(ctx)).drifted).toEqual([]); // 로컬은 실제 값·실제 경로지만 드리프트가 아니다
    expect(await fs.access(path.join(shed, "settings/enabledPlugins.json")).catch(() => "none")).toBe("none");
  });

  it("restore: 다른 기기의 settings.json 에 키만 넣고, ${HOME} 과 시크릿은 lshed 가 채운다", async () => {
    await init(ctxFor(rootA));
    await w(path.join(rootB, "settings.json"), J({ enabledPlugins: { "x@y": true }, statusLine: { type: "command", command: "mine" } }));
    process.env.ANTHROPIC_API_KEY = "sk-on-B";
    const ctx = ctxFor(rootB);
    const res = await restore(ctx, "default");
    const s = await rj(path.join(rootB, "settings.json"));
    expect(s.enabledPlugins).toEqual({ "x@y": true });
    expect(s.statusLine).toEqual({ type: "command", command: "mine" });
    expect(s.hooks.Stop[0].hooks[0].command).toBe(`${HOME}/.claude/hooks/notify.sh`); // settings.json 은 Claude Code 가 안 채우므로 실제 경로
    expect(s.env.ANTHROPIC_API_KEY).toBe("sk-on-B");
    expect(s.model).toBe("opus");
    expect(res.missingEnv).toEqual([]);
    expect(logs.join("\n")).not.toContain("${HOME}"); // HOME 은 늘 있으니 표시하지 않는다
    // 재적용은 "="
    logs = [];
    const again = await restore(ctx, "default");
    expect(again.backedUp).toEqual([]);
    expect(logs.filter((l) => /^\s+[=+~] settings:/.test(l)).every((l) => l.trim().startsWith("="))).toBe(true);
  });

  it("환경변수가 없으면 자리표시자를 그대로 두고 알린다", async () => {
    await init(ctxFor(rootA));
    const res = await restore(ctxFor(rootB), "default");
    expect(res.missingEnv).toEqual([{ rel: "settings:env", vars: ["ANTHROPIC_API_KEY"] }]);
    expect((await rj(path.join(rootB, "settings.json"))).env.ANTHROPIC_API_KEY).toBe("${ANTHROPIC_API_KEY}");
  });

  it("프로필 전환은 관리하는 키만 지우고 백업한다", async () => {
    const ctx = ctxFor(rootA);
    await init(ctx);
    const y = await fs.readFile(path.join(shed, "lshed.yaml"), "utf8");
    await fs.writeFile(path.join(shed, "lshed.yaml"), y + "  bare:\n    settings: [model]\n");
    const res = await restore(ctx, "bare");
    expect(res.removed).toEqual(["settings:env", "settings:hooks", "settings:permissions", "settings:theme", "skills/mine"]);
    const s = await rj(path.join(rootA, "settings.json"));
    expect(Object.keys(s).sort()).toEqual(["enabledPlugins", "model"]);
    expect(await rj(path.join(res.backupDir!, "settings/permissions.json"))).toEqual(permissions);
  });

  it("diff/save: 로컬에서 permissions 를 늘리면 키 경로로 보이고 save 가 가져온다", async () => {
    const ctx = ctxFor(rootA);
    await init(ctx);
    const s = await rj(path.join(rootA, "settings.json"));
    s.permissions.allow.push("Bash(git status)");
    s.hooks.Stop[0].hooks[0].command = `${HOME}/.claude/hooks/other.sh`;
    await w(path.join(rootA, "settings.json"), J(s));
    const d = await diff(ctx);
    expect(d.map((x) => `${x.item.category}/${x.item.id}`)).toEqual(["settings/hooks", "settings/permissions"]);
    expect(d[1].changes).toEqual([{ status: "M", file: "allow" }]);
    expect(await save(ctx)).toEqual(["settings/hooks", "settings/permissions"]);
    expect((await rj(path.join(shed, "settings/permissions.json"))).allow).toContain("Bash(git status)");
    expect((await rj(path.join(shed, "settings/hooks.json"))).Stop[0].hooks[0].command).toBe("${HOME}/.claude/hooks/other.sh");
    expect((await diff(ctx)).length).toBe(0);
  });

  it("add: 패키지 안을 가리키는 값이 있으면 경고한다", async () => {
    const ctx = ctxFor(rootA);
    await w(path.join(rootA, "settings.json"), J({ model: "opus" }));
    await init(ctx);
    // 툴킷을 설치했고 그 setup 이 훅을 써 넣었다
    const tk = path.join(rootA, "skills/tk");
    await w(path.join(tk, "hook.sh"), "");
    const { git } = await import("../src/git.js");
    await git(["init", "-q"], tk); await git(["remote", "add", "origin", "https://github.com/a/tk.git"], tk);
    await git(["add", "-A"], tk); await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "v1"], tk);
    await w(path.join(rootA, "settings.json"), J({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: `${tk}/hook.sh` }] }] } }));
    logs = [];
    await add(ctx);
    expect(logs.join("\n")).toMatch(/settings\/hooks\s+! 패키지 tk 안을 가리킵니다/);
  });
});
