import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gemini, copilot, cursor, codex, agy, canonical } from "../src/adapters/mcp-forms.js";
import { TomlEntries, removeBlock } from "../src/adapters/toml-entries.js";
import { createAdapter } from "../src/adapters/registry.js";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import { type Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { restore } from "../src/core/restore.js";
import { diff } from "../src/core/diff.js";
import { save } from "../src/core/save.js";
import type { Json } from "../src/core/entries.js";

const STDIO: Json = { type: "stdio", command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "${EXA_API_KEY}", MODE: "fast" } };
const HTTP: Json = { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer ${NOTION_AUTHORIZATION}", "X-Region": "us", "X-Key": "${X_KEY}" } };

describe("MCP 형식 변환 (창고 = Claude Code 형식)", () => {
  it("canonical: type 이 없으면 모양대로", () => {
    expect(canonical({ command: "x" })).toEqual({ type: "stdio", command: "x" });
    expect(canonical({ url: "u" })).toEqual({ type: "http", url: "u" });
    expect(canonical({ type: "sse", url: "u" })).toEqual({ type: "sse", url: "u" });
  });
  it("gemini: type 없음, http 는 httpUrl, 되돌리기", () => {
    expect(gemini.toLocal(STDIO)).toEqual({ command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "${EXA_API_KEY}", MODE: "fast" } });
    const h = gemini.toLocal(HTTP) as { [k: string]: Json };
    expect(h.httpUrl).toBe("https://mcp.notion.com/mcp"); expect(h.url).toBeUndefined(); expect(h.type).toBeUndefined();
    expect(gemini.fromLocal(gemini.toLocal(STDIO))).toEqual(STDIO);
    expect(gemini.fromLocal(gemini.toLocal(HTTP))).toEqual(HTTP);
    expect(gemini.fromLocal({ url: "https://sse", timeout: 5 })).toEqual({ type: "sse", url: "https://sse", timeout: 5 });
  });
  it("copilot: type local + tools, 되돌리면 tools 기본값은 사라짐", () => {
    expect(copilot.toLocal(STDIO)).toEqual({ ...(STDIO as object), type: "local", tools: ["*"] });
    expect(copilot.toLocal(HTTP)).toEqual({ ...(HTTP as object), tools: ["*"] });
    expect(copilot.fromLocal(copilot.toLocal(STDIO))).toEqual(STDIO);
    expect(copilot.fromLocal({ type: "local", command: "x", tools: ["a", "b"] })).toEqual({ type: "stdio", command: "x", tools: ["a", "b"] });
  });
  it("cursor: ${VAR} ↔ ${env:VAR}, ${HOME} ↔ ${userHome}, type 없음", () => {
    const l = cursor.toLocal({ ...(STDIO as object), args: ["${HOME}/bin/x"] }) as { [k: string]: Json };
    expect(l.type).toBeUndefined();
    expect((l.env as { [k: string]: Json }).EXA_API_KEY).toBe("${env:EXA_API_KEY}");
    expect((l.args as string[])[0]).toBe("${userHome}/bin/x");
    expect(cursor.fromLocal(cursor.toLocal(HTTP))).toEqual(HTTP);
    expect(cursor.fromLocal(l)).toEqual({ ...(STDIO as object), args: ["${HOME}/bin/x"] });
  });
  it("agy: type 없음, http 는 serverUrl, disabled:false 는 되돌릴 때 사라짐", () => {
    const http = { type: "http", url: "https://m/x", headers: { Authorization: "Bearer ${T}" } };
    expect(agy.toLocal(http)).toEqual({ serverUrl: "https://m/x", headers: { Authorization: "Bearer ${T}" } });
    expect(agy.fromLocal({ serverUrl: "https://m/x", disabled: false, headers: { Authorization: "Bearer ${T}" } })).toEqual(http);
    expect(agy.toLocal({ type: "stdio", command: "c", env: { K: "${K}" } })).toEqual({ command: "c", env: { K: "${K}" } });
    expect(agy.fromLocal({ command: "c", disabled: true })).toEqual({ type: "stdio", command: "c", disabled: true });
  });

  it("codex: 자리표시자를 env_vars / bearer_token_env_var / env_http_headers 로, 되돌리기", () => {
    const s = codex.toLocal({ ...(STDIO as object), args: ["${HOME}/x"] }, "/home/me") as { [k: string]: Json };
    expect(s).toEqual({ command: "npx", args: ["/home/me/x"], env: { MODE: "fast" }, env_vars: ["EXA_API_KEY"] });
    const h = codex.toLocal(HTTP) as { [k: string]: Json };
    expect(h).toEqual({ url: "https://mcp.notion.com/mcp", bearer_token_env_var: "NOTION_AUTHORIZATION", http_headers: { "X-Region": "us" }, env_http_headers: { "X-Key": "X_KEY" } });
    expect(codex.fromLocal(h)).toEqual(HTTP);
    expect(codex.fromLocal(codex.toLocal(STDIO, "/home/me"))).toEqual(STDIO);
    // 이름이 다른 자리표시자는 표현할 수 없어 그대로 남는다
    expect((codex.toLocal({ type: "stdio", command: "x", env: { K: "${OTHER}" } }) as { [k: string]: Json }).env).toEqual({ K: "${OTHER}" });
    expect(codex.fromLocal({ command: "x", startup_timeout_sec: 20 })).toEqual({ type: "stdio", command: "x", startup_timeout_sec: 20 });
  });
});

describe("TomlEntries (Codex config.toml)", () => {
  let tmp: string;
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-toml-")); });
  afterEach(() => fs.rm(tmp, { recursive: true, force: true }));
  const SEED = `# my codex config
model = "gpt-5"   # keep

[mcp_servers.old]
command = "old"

[mcp_servers.old.env]
A = "1"

[projects."/home/me/x"]
trust_level = "trusted"
`;
  it("항목만 바꾸고 주석·다른 표는 그대로", async () => {
    const file = path.join(tmp, "config.toml");
    await fs.writeFile(file, SEED);
    const e = new TomlEntries({ name: "mcp", file: async () => file, under: "mcp_servers", secretKeys: ["env"], expandsEnv: true });
    expect(await e.read()).toEqual({ old: { command: "old", env: { A: "1" } } });
    await e.write("exa", { command: "npx", args: ["-y", "exa"], env_vars: ["EXA_API_KEY"] });
    let t = await fs.readFile(file, "utf8");
    expect(t).toContain("# my codex config"); expect(t).toContain('model = "gpt-5"   # keep'); expect(t).toContain('[projects."/home/me/x"]');
    expect(t).toContain("[mcp_servers.exa]"); expect(t).toContain('env_vars = [ "EXA_API_KEY" ]');
    expect(await e.read()).toEqual({ old: { command: "old", env: { A: "1" } }, exa: { command: "npx", args: ["-y", "exa"], env_vars: ["EXA_API_KEY"] } });
    await e.write("old", { command: "new" });
    t = await fs.readFile(file, "utf8");
    expect(t).not.toContain('A = "1"'); expect(t).not.toContain('command = "old"'); expect(t).toContain('command = "new"');
    await e.write("exa", null);
    t = await fs.readFile(file, "utf8");
    expect(t).not.toContain("exa"); expect(t).toContain("trust_level");
    expect(await e.read()).toEqual({ old: { command: "new" } });
  });
  it("없는 파일에는 만들고, 인라인 표 형태도 지운다", async () => {
    const file = path.join(tmp, "sub", "config.toml");
    const e = new TomlEntries({ name: "mcp", file: async () => file, under: "mcp_servers", secretKeys: [], expandsEnv: true });
    expect(await e.read()).toEqual({});
    await e.write("a", { command: "a" });
    expect(await fs.readFile(file, "utf8")).toBe("[mcp_servers.a]\ncommand = \"a\"\n");
    expect(removeBlock("[mcp_servers]\na = { command = \"a\" }\nb = { command = \"b\" }\n", "mcp_servers", "a")).toBe("[mcp_servers]\nb = { command = \"b\" }\n");
  });
});

describe("MCP 를 다른 에이전트로 (§7.4)", () => {
  let tmp: string, shed: string, logs: string[];
  const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
  const r = (p: string) => fs.readFile(p, "utf8");
  const J = (o: unknown) => JSON.stringify(o, null, 2);
  const ctxOf = (adapter: Ctx["adapter"]): Ctx => ({ adapter, shed, log: (l) => logs.push(l), exec: async () => {} });
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-mcpx-")); shed = path.join(tmp, "shed"); logs = [];
    const claude = path.join(tmp, "claude");
    await w(path.join(claude, "skills/a/SKILL.md"), "a");
    await w(`${claude}.json`, J({ mcpServers: {
      exa: { type: "stdio", command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "sk-live", MODE: "fast" } },
      notion: { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer ntn_secret" } },
    } }));
    await init(ctxOf(new ClaudeCodeAdapter(claude)));
    logs = [];
  });
  afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

  it("codex: config.toml 에 환경변수 이름으로, 값은 파일에 안 들어감. 드리프트 없음, 편집은 save 로 돌아옴", async () => {
    const root = path.join(tmp, "codex");
    await w(path.join(root, "config.toml"), "# keep me\nmodel = \"gpt-5\"\n");
    const ctx = ctxOf(createAdapter("codex", root));
    const res = await restore(ctx, "default");
    expect(res.placed.sort()).toEqual(["mcp:exa", "mcp:notion", "skills/a"]);
    const t = await r(path.join(root, "config.toml"));
    expect(t).toContain("# keep me");
    expect(t).toContain('env_vars = [ "EXA_API_KEY" ]'); expect(t).toContain('bearer_token_env_var = "NOTION_AUTHORIZATION"');
    expect(t).not.toContain("sk-live"); expect(t).not.toContain("ntn_secret");
    expect(res.missingEnv.map((m) => m.vars).flat().sort()).toEqual(["EXA_API_KEY", "NOTION_AUTHORIZATION"]); // 이름만 넘기지만 실행 때 셸에 있어야 하니 알린다
    expect(await diff(ctx)).toEqual([]);
    // Codex 쪽에서 인자를 고치면 save 가 창고로 되가져온다 (자리표시자는 보존)
    await fs.writeFile(path.join(root, "config.toml"), t.replace('args = [ "-y", "exa-mcp" ]', 'args = [ "-y", "exa-mcp", "--fast" ]'));
    expect((await diff(ctx)).map((d) => d.item.id)).toEqual(["exa"]);
    expect(await save(ctx)).toEqual(["mcp/exa"]);
    expect(JSON.parse(await r(path.join(shed, "mcp/exa.json")))).toEqual({ type: "stdio", command: "npx", args: ["-y", "exa-mcp", "--fast"], env: { EXA_API_KEY: "${EXA_API_KEY}", MODE: "fast" } });
  });

  it("gemini / copilot / cursor: 각자 형식으로, 드리프트 없음", async () => {
    process.env.EXA_API_KEY = "on-this-box"; process.env.NOTION_AUTHORIZATION = "tok";
    try {
      const g = path.join(tmp, "gemini");
      await w(path.join(g, "settings.json"), J({ theme: "dark" }));
      const gctx = ctxOf(createAdapter("gemini", g));
      await restore(gctx, "default");
      const gs = JSON.parse(await r(path.join(g, "settings.json")));
      expect(gs.theme).toBe("dark");
      expect(gs.mcpServers.exa).toEqual({ command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "on-this-box", MODE: "fast" } });
      expect(gs.mcpServers.notion).toEqual({ httpUrl: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer tok" } });
      expect(await diff(gctx)).toEqual([]);

      const c = path.join(tmp, "copilot");
      const cctx = ctxOf(createAdapter("copilot", c));
      await restore(cctx, "default");
      const cs = JSON.parse(await r(path.join(c, "mcp-config.json")));
      expect(cs.mcpServers.exa.type).toBe("local"); expect(cs.mcpServers.exa.tools).toEqual(["*"]); expect(cs.mcpServers.notion.type).toBe("http");
      expect(await diff(cctx)).toEqual([]);

      const u = path.join(tmp, "cursor");
      const uctx = ctxOf(createAdapter("cursor", u));
      const res = await restore(uctx, "default");
      const us = JSON.parse(await r(path.join(u, "mcp.json")));
      expect(us.mcpServers.exa).toEqual({ command: "npx", args: ["-y", "exa-mcp"], env: { EXA_API_KEY: "${env:EXA_API_KEY}", MODE: "fast" } });
      expect(us.mcpServers.notion.headers.Authorization).toBe("Bearer ${env:NOTION_AUTHORIZATION}");
      expect(res.missingEnv).toEqual([]);
      expect(await diff(uctx)).toEqual([]);
    } finally { delete process.env.EXA_API_KEY; delete process.env.NOTION_AUTHORIZATION; }
  });

  it("gemini 기기에서 init 하면 창고에는 Claude 형식 + 마스킹으로 들어간다", async () => {
    const g = path.join(tmp, "gemini2");
    await w(path.join(g, "skills/x/SKILL.md"), "x");
    await w(path.join(g, "settings.json"), J({ mcpServers: { srv: { command: "python", args: ["-m", "srv"], env: { API_KEY: "plain-secret" } }, web: { httpUrl: "https://h", headers: { Authorization: "Bearer abc" } } } }));
    const shed2 = path.join(tmp, "shed2");
    const { manifest } = await init({ ...ctxOf(createAdapter("gemini", g)), shed: shed2 });
    expect(manifest.profiles.default).toEqual({ skills: ["x"], mcp: ["srv", "web"] });
    expect(JSON.parse(await r(path.join(shed2, "mcp/srv.json")))).toEqual({ type: "stdio", command: "python", args: ["-m", "srv"], env: { API_KEY: "${API_KEY}" } });
    expect(JSON.parse(await r(path.join(shed2, "mcp/web.json")))).toEqual({ type: "http", url: "https://h", headers: { Authorization: "Bearer ${WEB_AUTHORIZATION}" } });
    // 그 창고를 Claude Code 로 restore 하면 ~/.claude.json 에 type 이 붙은 채로
    const claude2 = path.join(tmp, "claude2");
    const res = await restore({ ...ctxOf(new ClaudeCodeAdapter(claude2)), shed: shed2 }, "default");
    expect(res.placed).toContain("mcp:srv");
    expect(JSON.parse(await r(`${claude2}.json`)).mcpServers.srv.type).toBe("stdio");
  });
});
