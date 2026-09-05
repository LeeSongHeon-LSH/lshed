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
import { remove } from "../src/core/remove.js";
import { readState } from "../src/state.js";
import { mask, expand, matches, remask, diffEntry } from "../src/core/entries.js";

let tmp: string, rootA: string, rootB: string, shed: string, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const rj = async (p: string) => JSON.parse(await fs.readFile(p, "utf8"));
const J = (o: unknown) => JSON.stringify(o, null, 2);
const ctxFor = (root: string): Ctx => ({ adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} });
const mcp = { secretKeys: ["env", "headers"] as const };

const exa = { type: "stdio", command: "npx", args: ["-y", "exa-mcp-server"], env: { EXA_API_KEY: "sk-exa-1234567890", NODE_ENV: "production" } };
const notion = { type: "http", url: "https://mcp.notion.com/mcp", headers: { Authorization: "Bearer ntn_abcdefghijk", "X-Client": "lshed" } };
const plain = { type: "stdio", command: "uvx", args: ["mcp-server-fetch"] };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-mcp-"));
  rootA = path.join(tmp, "A"); rootB = path.join(tmp, "B"); shed = path.join(tmp, "shed"); logs = [];
  await w(path.join(rootA, "skills/mine/SKILL.md"), "authored");
  // 기기 A 의 ~/.claude.json: MCP 3개 + 다른 상태값
  await w(`${rootA}.json`, J({ machineID: "A", numStartups: 7, mcpServers: { exa, notion, plain } }));
  delete process.env.EXA_API_KEY; delete process.env.NOTION_AUTHORIZATION;
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

describe("entries: 순수 로직", () => {
  it("mask: 시크릿 같은 키만 자리표시자로, 헤더는 스킴 단어를 남긴다", () => {
    expect(mask("exa", exa, mcp)).toEqual({ ...exa, env: { EXA_API_KEY: "${EXA_API_KEY}", NODE_ENV: "production" } });
    expect(mask("notion", notion, mcp)).toEqual({ ...notion, headers: { Authorization: "Bearer ${NOTION_AUTHORIZATION}", "X-Client": "lshed" } });
    expect(mask("plain", plain, mcp)).toEqual(plain);
    // 이미 자리표시자면 그대로
    const m = mask("exa", exa, mcp);
    expect(mask("exa", m, mcp)).toEqual(m);
  });
  it("expand: 환경변수로 채우고 없는 것은 missing 에", () => {
    const m = mask("notion", notion, mcp);
    expect(expand(m, {})).toEqual({ value: m, missing: ["NOTION_AUTHORIZATION"] });
    expect(expand(m, { NOTION_AUTHORIZATION: "ntn_x" }).value).toEqual(notion === null ? null : { ...notion, headers: { ...notion.headers, Authorization: "Bearer ntn_x" } });
    expect(expand({ a: "${X:-dflt}" }, {})).toEqual({ value: { a: "dflt" }, missing: [] });
  });
  it("matches: 자리표시자는 와일드카드, 그대로 남아 있어도 맞는다", () => {
    const m = mask("exa", exa, mcp);
    expect(matches(m, exa)).toBe(true);
    expect(matches(m, m)).toBe(true);
    expect(matches(m, { ...exa, args: ["-y", "other"] })).toBe(false);
    expect(matches(m, { ...exa, env: { EXA_API_KEY: "sk-exa-1234567890" } })).toBe(false); // NODE_ENV 빠짐
    expect(matches({ h: "Bearer ${T}" }, { h: "Basic xyz" })).toBe(false);
  });
  it("remask: 자리표시자 보존 + 새 시크릿 키 마스킹", () => {
    const m = mask("exa", exa, mcp);
    const edited = { ...exa, args: ["-y", "exa-mcp-server@2"], env: { ...exa.env, EXA_API_KEY: "sk-rotated", OTHER_TOKEN: "t0k" } };
    expect(remask("exa", edited, m, mcp)).toEqual({ ...edited, env: { EXA_API_KEY: "${EXA_API_KEY}", NODE_ENV: "production", OTHER_TOKEN: "${OTHER_TOKEN}" } });
  });
  it("diffEntry: 키 경로 단위", () => {
    const m = mask("exa", exa, mcp);
    expect(diffEntry(m, { ...exa, args: ["-y", "x"], env: { EXA_API_KEY: "k" } })).toEqual([
      { status: "M", file: "args" }, { status: "D", file: "env.NODE_ENV" },
    ]);
    expect(diffEntry(m, undefined)).toEqual([{ status: "D", file: "(entry)" }]);
  });
});

describe("init: MCP 를 mcp/<id>.json 으로 담는다", () => {
  it("시크릿은 자리표시자로, 로컬 파일은 그대로", async () => {
    const ctx = ctxFor(rootA);
    const { manifest, copied } = await init(ctx);
    expect(copied).toBe(4);
    expect(manifest.components.mcp?.map((c) => c.id)).toEqual(["exa", "notion", "plain"]);
    expect(manifest.profiles.default.mcp).toEqual(["exa", "notion", "plain"]);
    expect(await rj(path.join(shed, "mcp/exa.json"))).toEqual({ ...exa, env: { EXA_API_KEY: "${EXA_API_KEY}", NODE_ENV: "production" } });
    expect(await rj(path.join(shed, "mcp/notion.json"))).toEqual({ ...notion, headers: { Authorization: "Bearer ${NOTION_AUTHORIZATION}", "X-Client": "lshed" } });
    // 창고 어디에도 시크릿 값이 없다
    for (const f of ["mcp/exa.json", "mcp/notion.json", "lshed.yaml"]) expect(await fs.readFile(path.join(shed, f), "utf8")).not.toMatch(/sk-exa|ntn_abc/);
    expect((await readState(ctx.adapter))?.managed).toEqual(expect.arrayContaining(["mcp:exa", "mcp:notion", "mcp:plain", "skills/mine"]));
    expect(await rj(`${rootA}.json`)).toEqual({ machineID: "A", numStartups: 7, mcpServers: { exa, notion, plain } });
    expect(logs.join("\n")).toContain("mcp/exa  (시크릿 → ${EXA_API_KEY})");
    expect(await status(ctx)).toMatchObject({ drifted: [] });
  });
  it("--exclude mcp/notion", async () => {
    const { manifest, skipped } = await init(ctxFor(rootA), { exclude: ["mcp/notion"] });
    expect(skipped).toEqual(["mcp/notion"]);
    expect(manifest.profiles.default.mcp).toEqual(["exa", "plain"]);
  });
  it("args 에 시크릿처럼 보이는 값이 있으면 경고", async () => {
    await w(`${rootA}.json`, J({ mcpServers: { x: { type: "stdio", command: "srv", args: ["--key", "sk-abcdefghijklmnop"] } } }));
    await init(ctxFor(rootA));
    expect(logs.join("\n")).toContain("args.1 가 시크릿처럼 보입니다");
  });
});

describe("restore: 다른 기기의 ~/.claude.json 에 그 키만 넣는다", () => {
  beforeEach(async () => {
    await init(ctxFor(rootA));
    const y = await fs.readFile(path.join(shed, "lshed.yaml"), "utf8");
    await fs.writeFile(path.join(shed, "lshed.yaml"), y + "  minimal:\n    mcp: [plain]\n");
    await w(`${rootB}.json`, J({ machineID: "B", mcpServers: { theirs: plain } }));
    logs = [];
  });

  it("자리표시자를 그대로 배치하고(에이전트가 확장) 다른 키는 보존, 없는 환경변수를 알린다", async () => {
    const ctx = ctxFor(rootB);
    process.env.EXA_API_KEY = "sk-on-B";
    const res = await restore(ctx, "default");
    const b = await rj(`${rootB}.json`);
    expect(b.machineID).toBe("B");
    expect(b.mcpServers.theirs).toEqual(plain);
    expect(b.mcpServers.exa.env.EXA_API_KEY).toBe("${EXA_API_KEY}"); // 값은 셸 환경에서, Claude Code 가 확장
    expect(b.mcpServers.notion.headers.Authorization).toBe("Bearer ${NOTION_AUTHORIZATION}");
    expect(res.placed).toEqual(expect.arrayContaining(["mcp:exa", "mcp:notion", "mcp:plain"]));
    expect(res.backedUp).toEqual([]);
    expect(res.missingEnv).toEqual([{ rel: "mcp:notion", vars: ["NOTION_AUTHORIZATION"] }]);
    expect(logs.join("\n")).toContain("mcp:notion: NOTION_AUTHORIZATION");
    expect((await status(ctx)).missingEnv).toEqual([{ rel: "mcp:notion", vars: ["NOTION_AUTHORIZATION"] }]);
    // 재적용은 "=" 이고 백업 없음
    logs = [];
    const again = await restore(ctx, "default");
    expect(again.backedUp).toEqual([]);
    const marks = logs.filter((l) => /^\s+[=+~] mcp:/.test(l));
    expect(marks).toHaveLength(3);
    expect(marks.every((l) => l.trim().startsWith("="))).toBe(true);
  });

  it("CLAUDE_CONFIG_DIR 아래 새 기기: .claude.json 을 그 안에 만든다 (형제 파일은 Claude Code 가 안 읽음)", async () => {
    const dir = path.join(tmp, "C");
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      const ctx: Ctx = { adapter: new ClaudeCodeAdapter(), shed, log: (l) => logs.push(l), exec: async () => {} };
      await restore(ctx, "minimal");
      expect((await rj(path.join(dir, ".claude.json"))).mcpServers.plain).toEqual(plain);
      await expect(fs.access(`${dir}.json`)).rejects.toThrow();
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    }
  });

  it("dry-run 은 파일을 건드리지 않는다", async () => {
    await restore(ctxFor(rootB), "default", { dryRun: true });
    expect(Object.keys((await rj(`${rootB}.json`)).mcpServers)).toEqual(["theirs"]);
  });

  it("프로필 전환: 관리 집합의 항목만 지우고 백업, 사용자 항목은 남긴다", async () => {
    const ctx = ctxFor(rootB);
    await restore(ctx, "default");
    logs = [];
    const res = await restore(ctx, "minimal");
    expect(res.removed).toEqual(["mcp:exa", "mcp:notion", "skills/mine"]);
    const b = await rj(`${rootB}.json`);
    expect(Object.keys(b.mcpServers).sort()).toEqual(["plain", "theirs"]);
    expect(b.machineID).toBe("B");
    expect(await rj(path.join(res.backupDir!, "mcp/exa.json"))).toMatchObject({ command: "npx" });
    expect((await readState(ctx.adapter))?.managed).toEqual(["mcp:plain"]);
  });

  it("로컬에 이미 다른 값이 있으면 백업 후 덮어쓴다", async () => {
    await w(`${rootB}.json`, J({ mcpServers: { exa: { ...exa, args: ["old"] } } }));
    const res = await restore(ctxFor(rootB), "default");
    expect(res.backedUp).toEqual(["mcp:exa"]);
    expect(await rj(path.join(res.backupDir!, "mcp/exa.json"))).toMatchObject({ args: ["old"] });
    expect((await rj(`${rootB}.json`)).mcpServers.exa.args).toEqual(exa.args);
  });

  it("A 에서 실제 값이 든 채로도 드리프트가 아니다 (자리표시자 = 와일드카드)", async () => {
    const ctx = ctxFor(rootA);
    expect((await diff(ctx)).length).toBe(0);
    logs = [];
    const res = await restore(ctx, "default");
    expect(res.backedUp).toEqual([]);
    expect((await rj(`${rootA}.json`)).mcpServers.exa.env.EXA_API_KEY).toBe("sk-exa-1234567890"); // 실제 값 유지
  });
});

describe("diff / save: 항목형", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = ctxFor(rootA);
    await init(ctx);
    logs = [];
  });

  it("로컬 편집은 키 경로로 보이고, save 는 자리표시자를 보존하며 새 시크릿을 마스킹한다", async () => {
    const a = await rj(`${rootA}.json`);
    a.mcpServers.exa = { ...exa, args: ["-y", "exa-mcp-server@2"], env: { ...exa.env, EXA_API_KEY: "sk-rotated", OTHER_TOKEN: "t0k" } };
    await w(`${rootA}.json`, J(a));
    const d = await diff(ctx);
    expect(d.map((x) => `${x.item.category}/${x.item.id}`)).toEqual(["mcp/exa"]);
    expect(d[0].changes).toEqual([{ status: "M", file: "args" }, { status: "A", file: "env.OTHER_TOKEN" }]);
    expect(await save(ctx)).toEqual(["mcp/exa"]);
    expect(await rj(path.join(shed, "mcp/exa.json"))).toEqual({
      ...exa, args: ["-y", "exa-mcp-server@2"], env: { EXA_API_KEY: "${EXA_API_KEY}", NODE_ENV: "production", OTHER_TOKEN: "${OTHER_TOKEN}" },
    });
    expect((await diff(ctx)).length).toBe(0);
  });

  it("로컬에서 지운 항목은 D 로 보이고 save 는 건너뛴다", async () => {
    const a = await rj(`${rootA}.json`);
    delete a.mcpServers.plain;
    await w(`${rootA}.json`, J(a));
    const d = await diff(ctx);
    expect(d.map((x) => x.item.id)).toEqual(["plain"]);
    expect(d[0].changes).toEqual([{ status: "D", file: "(entry)" }]);
    expect(await save(ctx, ["mcp/plain"])).toEqual([]);
  });

  it("remove: 프로필이 쓰는 동안은 거부, 빼면 창고 json 삭제", async () => {
    await expect(remove(ctx, "mcp/plain")).rejects.toThrow(/default/);
    const y = (await fs.readFile(path.join(shed, "lshed.yaml"), "utf8")).replace("      - plain\n", "");
    await fs.writeFile(path.join(shed, "lshed.yaml"), y);
    const r = await remove(ctx, "mcp/plain");
    expect(r.deleted).toBe(path.join(shed, "mcp/plain.json"));
    await expect(fs.access(r.deleted!)).rejects.toThrow();
  });
});
