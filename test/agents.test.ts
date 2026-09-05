import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { SkillsDirAdapter, SKILLS_DIR_AGENTS } from "../src/adapters/skills-dir.js";
import { createAdapter, adapterNames } from "../src/adapters/registry.js";
import { type Ctx, loadManifest, manifestAgent } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { restore } from "../src/core/restore.js";
import { status, formatStatus } from "../src/core/status.js";
import { readState } from "../src/state.js";
import { exists } from "../src/fsutil.js";

let tmp: string, shed: string, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const J = (o: unknown) => JSON.stringify(o, null, 2);
const ctxOf = (adapter: Ctx["adapter"]): Ctx => ({ adapter, shed, log: (l) => logs.push(l), exec: async () => {} });

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-agents-"));
  shed = path.join(tmp, "shed"); logs = [];
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("SkillsDirAdapter", () => {
  it("skills/<name>/ 한 단계만, 숨김·파일은 무시", async () => {
    const root = path.join(tmp, "codex");
    await w(path.join(root, "skills/a/SKILL.md"), "a");
    await w(path.join(root, "skills/.hidden/SKILL.md"), "");
    await w(path.join(root, "skills/README.md"), "");
    await w(path.join(root, "AGENTS.md"), "rules");
    const found = await createAdapter("gemini", root).scan();
    expect(found.map((c) => `${c.category}/${c.id}`)).toEqual(["skills/a"]);
    expect((await createAdapter("cursor", root).scan()).length).toBe(1);
    // codex 는 스킬을 루트가 아니라 홈의 .agents/skills 에서 본다 (루트를 준 테스트에서는 그 부모가 홈)
    expect((await createAdapter("codex", root).scan()).length).toBe(0);
    await w(path.join(tmp, ".agents/skills/z/SKILL.md"), "z");
    expect((await createAdapter("codex", root).scan()).map((c) => c.id)).toEqual(["z"]);
  });

  it("레지스트리: 이름·루트·환경변수·지침 파일", () => {
    expect(adapterNames()).toEqual(["claude-code", "codex", "gemini", "copilot", "cursor", "agy", "agents"]);
    expect(createAdapter("claude-code", "/x")).toBeInstanceOf(ClaudeCodeAdapter);
    const codex = createAdapter("codex", "/x");
    expect(codex).toBeInstanceOf(SkillsDirAdapter);
    expect(codex.instructionsFileName()).toBe("AGENTS.md");
    expect(codex.instructionsStrategy()).toBe("concat");
    expect(codex.categories()[0].root).toBe("../.agents/skills");                       // 루트 /x → 홈은 /
    expect(createAdapter("codex", "/home/me/.codex", "/home/me").categories()[0].root).toBe("../.agents/skills");
    expect(createAdapter("codex", "/opt/codex", "/home/me").categories()[0].root).toBe("../../home/me/.agents/skills");
    expect(createAdapter("agents", "/x").categories()[0].root).toBe("skills");
    expect(createAdapter("agents", "/x").instructionsFileName()).toBeNull();
    expect(createAdapter("cursor", "/x").instructionsFileName()).toBeNull();
    expect(createAdapter("copilot", "/x").instructionsFileName()).toBe("copilot-instructions.md");
    expect(() => createAdapter("nope")).toThrow(/모르는 에이전트 "nope"/);
    const saved = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(tmp, "elsewhere");
    try { expect(createAdapter("codex").root).toBe(path.join(tmp, "elsewhere")); } finally {
      if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
    }
    expect(createAdapter("gemini").root).toBe(path.join(os.homedir(), ".gemini"));
    expect(SKILLS_DIR_AGENTS.map((s) => s.dir)).toEqual([".codex", ".gemini", ".copilot", ".cursor", ".gemini/config", ".agents"]);
  });
});

describe("창고 하나를 여러 에이전트가 쓴다 (§4.6)", () => {
  let claudeRoot: string;
  beforeEach(async () => {
    // Claude Code 기기에서 만든 창고: skills 2, agents 1, 지침, MCP 1, 그리고 Claude 전용 패키지
    claudeRoot = path.join(tmp, "claude");
    await w(path.join(claudeRoot, "skills/alpha/SKILL.md"), "alpha");
    await w(path.join(claudeRoot, "skills/beta/SKILL.md"), "beta");
    await w(path.join(claudeRoot, "agents/rev.md"), "reviewer");
    await w(path.join(claudeRoot, "CLAUDE.md"), "# my rules\nbe nice\n");
    await w(`${claudeRoot}.json`, J({ mcpServers: { exa: { type: "stdio", command: "x", env: { EXA_API_KEY: "sk" } } } }));
    await init(ctxOf(new ClaudeCodeAdapter(claudeRoot)));
    const y = await r(path.join(shed, "lshed.yaml"));
    await fs.writeFile(path.join(shed, "lshed.yaml"), y.replace("profiles:\n  default:\n", "profiles:\n  default:\n    packages: [exa]\n") + "packages:\n  - id: exa\n    source: claude-plugin:exa@claude-plugins-official\n");
    logs = [];
  });

  it("agents(~/.agents): skills 만 놓고, 모르는 카테고리·설치 못 하는 패키지는 알리고 건너뛴다", async () => {
    const root = path.join(tmp, "dot-agents");
    const ctx = ctxOf(createAdapter("agents", root));
    const m = await loadManifest(ctx); // Claude 전용 카테고리·스킴이 있어도 열린다
    expect(Object.keys(m.components)).toContain("mcp");
    const res = await restore(ctx, "default");
    expect(res.placed.sort()).toEqual(["skills/alpha", "skills/beta"]);
    expect(await r(path.join(root, "skills/alpha/SKILL.md"))).toBe("alpha");
    expect(await exists(path.join(root, "agents"))).toBe(false);
    expect(await exists(`${root}.json`)).toBe(false);
    expect(await exists(path.join(root, "CLAUDE.md"))).toBe(false);
    const out = logs.join("\n");
    expect(out).toMatch(/agents 은 .*mcp.* 를 다루지 않아 건너뜁니다/);
    expect(out).toContain("agents 은 agents, mcp, instructions 를");
    expect(out).toContain("package exa  (claude-plugin: 는 agents 로 설치할 수 없어 건너뜀)");
    // state 는 에이전트 루트마다 따로
    expect((await readState(ctx.adapter))?.managed).toEqual(["skills/alpha", "skills/beta"]);
    expect((await readState(new ClaudeCodeAdapter(claudeRoot)))?.managed).toContain("agents/rev.md");
    expect((await status(ctx)).drifted).toEqual([]);
    expect(formatStatus(await status(ctx), root, "agents")).toContain(`(agents: ${root})`);
  });

  it("codex: skills 는 ~/.agents/skills 에, AGENTS.md 이어붙임, --link 도 된다", async () => {
    const root = path.join(tmp, "codex");                       // 홈은 tmp
    const ctx = ctxOf(createAdapter("codex", root));
    const res = await restore(ctx, "default", { link: true });
    expect(res.placed.sort()).toEqual(["../.agents/skills/alpha", "../.agents/skills/beta", "AGENTS.md", "lshed/instructions/main.md", "mcp:exa"]);
    const agentsMd = await r(path.join(root, "AGENTS.md"));
    expect(agentsMd).toContain("generated by lshed");
    expect(agentsMd).toContain("be nice");
    expect(agentsMd).not.toContain("@lshed/"); // import 문법이 없으니 내용을 넣는다
    expect((await fs.lstat(path.join(tmp, ".agents/skills/alpha"))).isSymbolicLink()).toBe(true);
    expect(await exists(path.join(root, "skills"))).toBe(false);
    // 프로필 전환은 홈 아래 스킬을 치우고, 백업은 codex 루트의 백업 디렉터리 안에 머문다
    await w(path.join(tmp, ".agents/skills/alpha/SKILL.md"), "edited through link");  // 링크라 창고가 바뀜
    const y = await r(path.join(shed, "lshed.yaml"));
    await fs.writeFile(path.join(shed, "lshed.yaml"), y.replace("profiles:\n  default:\n", "profiles:\n  none: {}\n  default:\n"));
    const sw = await restore(ctx, "none", { link: false });
    expect(await exists(path.join(tmp, ".agents/skills/alpha"))).toBe(false);
    expect(sw.removed.sort()).toEqual(["../.agents/skills/alpha", "../.agents/skills/beta", "AGENTS.md", "lshed/instructions/main.md", "mcp:exa"]);
    expect(await r(path.join(shed, "skills/alpha/SKILL.md"))).toBe("edited through link");  // 창고는 남는다
  });

  it("agy: 스킬은 config/skills, 규칙은 한 단계 위 ../AGENTS.md, 백업은 백업 디렉터리 안에 머문다", async () => {
    const gemini = path.join(tmp, "gemini");                 // ~/.gemini 역할
    const root = path.join(gemini, "config");
    await w(path.join(gemini, "AGENTS.md"), "my own rules\n");
    const ctx = ctxOf(createAdapter("agy", root));
    process.env.EXA_API_KEY = "sk";
    let res;
    try { res = await restore(ctx, "default"); } finally { delete process.env.EXA_API_KEY; }
    expect(await r(path.join(root, "skills/alpha/SKILL.md"))).toBe("alpha");
    expect(await r(path.join(gemini, "AGENTS.md"))).toContain("# my rules");
    const mcp = JSON.parse(await r(path.join(root, "mcp_config.json")));
    expect(mcp.mcpServers.exa).toEqual({ command: "x", env: { EXA_API_KEY: "sk" } });   // type 없음, restore 가 값을 채움
    expect(res.backedUp).toEqual(["../AGENTS.md"]);
    expect(await r(path.join(res.backupDir!, "__", "AGENTS.md"))).toBe("my own rules\n");
    expect(await exists(path.join(root, "lshed", "AGENTS.md"))).toBe(false);
    expect((await readState(ctx.adapter))!.managed).toContain("../AGENTS.md");
  });

  it("codex 기기에서 init 한 창고를 Claude Code 가 restore 한다 (agent 필드는 기본값일 뿐)", async () => {
    const codexRoot = path.join(tmp, "codex");
    await w(path.join(tmp, ".agents/skills/gamma/SKILL.md"), "gamma");   // codex 의 스킬 위치 (홈 = tmp)
    await w(path.join(codexRoot, "AGENTS.md"), "codex rules\n");
    const shed2 = path.join(tmp, "shed2");
    const cctx: Ctx = { ...ctxOf(createAdapter("codex", codexRoot)), shed: shed2 };
    const { manifest } = await init(cctx);
    expect(manifest.agent).toBe("codex");
    expect(manifestAgent(await r(path.join(shed2, "lshed.yaml")))).toBe("codex");
    expect(manifest.profiles.default).toEqual({ skills: ["gamma"], instructions: ["main"] });

    const claude2 = path.join(tmp, "claude2");
    const ctx = { ...ctxOf(new ClaudeCodeAdapter(claude2)), shed: shed2 };
    const res = await restore(ctx, "default");
    expect(res.placed.sort()).toEqual(["CLAUDE.md", "lshed/instructions/main.md", "skills/gamma"]);
    expect(await r(path.join(claude2, "CLAUDE.md"))).toContain("@lshed/instructions/main.md");
    expect(logs.join("\n")).not.toContain("건너뜁니다");
  });

  it("지침 파일이 없는 에이전트(cursor)로 init 하면 instructions 없이 만들어진다", async () => {
    const root = path.join(tmp, "cursor");
    await w(path.join(root, "skills/a/SKILL.md"), "a");
    const shed2 = path.join(tmp, "shed3");
    const { manifest } = await init({ ...ctxOf(createAdapter("cursor", root)), shed: shed2 });
    expect(manifest.profiles.default).toEqual({ skills: ["a"] });
  });

  it("모르는 agent 가 적힌 매니페스트는 거부", async () => {
    await fs.writeFile(path.join(shed, "lshed.yaml"), (await r(path.join(shed, "lshed.yaml"))).replace("agent: claude-code", "agent: windsurf"));
    await expect(loadManifest(ctxOf(createAdapter("codex", path.join(tmp, "x"))))).rejects.toThrow(/agent "windsurf" 를 모릅니다/);
  });
});
