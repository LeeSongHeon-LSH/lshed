import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";
import type { Ctx } from "../src/core/context.js";
import { init } from "../src/core/init.js";
import { add } from "../src/core/add.js";
import { restore } from "../src/core/restore.js";
import { status } from "../src/core/status.js";
import { readState } from "../src/state.js";
import { readLock } from "../src/lock.js";
import { git } from "../src/git.js";

let tmp: string, root: string, shed: string, ctx: Ctx, logs: string[];
const w = (p: string, c = "") => fs.mkdir(path.dirname(p), { recursive: true }).then(() => fs.writeFile(p, c));
const r = (p: string) => fs.readFile(p, "utf8");
const J = (o: unknown) => JSON.stringify(o, null, 2);

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-add-"));
  root = path.join(tmp, "claude"); shed = path.join(tmp, "shed"); logs = [];
  ctx = { adapter: new ClaudeCodeAdapter(root), shed, log: (l) => logs.push(l), exec: async () => {} };
  await w(path.join(root, "skills/alpha/SKILL.md"), "alpha");
  await w(path.join(root, "skills/alias/SKILL.md"), "alias made by an installer");
  await w(`${root}.json`, J({ mcpServers: { exa: { type: "stdio", command: "x", env: { EXA_API_KEY: "sk-1" } } } }));
  await init(ctx, { exclude: ["skills/alias"] });
  // 손으로 고친 주석이 살아남는지 보기 위해
  await fs.writeFile(path.join(shed, "lshed.yaml"), (await r(path.join(shed, "lshed.yaml"))).replace("    - id: alpha", "    - id: alpha   # my first skill"));
  logs = [];
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

async function appear() {
  await w(path.join(root, "skills/beta/SKILL.md"), "beta");
  await w(path.join(root, "agents/rev.md"), "reviewer");
  const a = JSON.parse(await r(`${root}.json`));
  a.mcpServers.notion = { type: "http", url: "https://n", headers: { Authorization: "Bearer ntn_1" } };
  await w(`${root}.json`, J(a));
  // clone 한 툴킷 + 그것이 만든 스텁
  const tk = path.join(root, "skills/tk");
  await w(path.join(tk, "SKILL.md"), "toolkit");
  await w(path.join(tk, "bin/tool"), "");
  await git(["init", "-q"], tk);
  await git(["remote", "add", "origin", "https://github.com/a/tk.git"], tk);
  await git(["add", "-A"], tk);
  await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "v1"], tk);
  await w(path.join(root, "skills/stub/SKILL.md"), "stub");
  await fs.symlink(path.join(tk, "bin"), path.join(root, "skills/stub/bin"));
}

describe("lshed add", () => {
  it("init 직후엔 후보가 없고 exclude 는 기억된다", async () => {
    expect(await add(ctx)).toEqual([]);
    expect(logs.join("\n")).toContain("창고에 없는 새 항목이 없습니다");
    expect((await status(ctx)).fresh).toEqual([]);
    expect(await r(path.join(shed, "lshed.yaml"))).toContain("exclude:\n  - skills/alias");
  });

  it("키 없이 부르면 후보만 보여주고 아무것도 바꾸지 않는다", async () => {
    await appear();
    const before = await r(path.join(shed, "lshed.yaml"));
    expect(await add(ctx)).toEqual([]);
    const out = logs.join("\n");
    expect(out).toContain("창고에 없는 항목 4개");
    for (const k of ["skills/beta", "agents/rev", "mcp/notion", "packages/tk  github:a/tk@"]) expect(out).toContain(k);
    expect(out).toContain("패키지 tk 가 생성한 것 1개는 담지 않습니다");
    expect(out).not.toContain("skills/alias");
    expect(await r(path.join(shed, "lshed.yaml"))).toBe(before);
    expect((await status(ctx)).fresh).toEqual(["packages/tk", "skills/beta", "agents/rev", "mcp/notion"]);
  });

  it("고른 것만 넣는다: 복사 + 매니페스트(주석 보존) + 프로필 + 관리 집합", async () => {
    await appear();
    expect(await add(ctx, ["beta", "mcp/notion"])).toEqual(["skills/beta", "mcp/notion"]);
    expect(await r(path.join(shed, "skills/beta/SKILL.md"))).toBe("beta");
    expect(JSON.parse(await r(path.join(shed, "mcp/notion.json"))).headers.Authorization).toBe("Bearer ${NOTION_AUTHORIZATION}");
    const y = await r(path.join(shed, "lshed.yaml"));
    expect(y).toContain("# my first skill");
    expect(y).toContain("    - id: beta");
    expect(y).toMatch(/profiles:\n  default:\n[\s\S]*skills:\n      - alpha\n      - beta/);
    expect(y).toMatch(/mcp:\n      - exa\n      - notion/);
    const st = await readState(ctx.adapter);
    expect(st?.managed).toEqual(["mcp:exa", "mcp:notion", "skills/alpha", "skills/beta"]);
    // 남은 후보는 아직 보인다
    expect((await status(ctx)).fresh).toEqual(["packages/tk", "agents/rev"]);
    // 넣은 것은 드리프트도 백업도 없이 "=" 다
    logs = [];
    const res = await restore(ctx, "default");
    expect(res.backedUp).toEqual([]);
    expect(logs.some((l) => l.trim() === "= skills/beta")).toBe(true);
  });

  it("--all: 패키지는 출처+락으로, 스텁은 건너뛴다", async () => {
    await appear();
    const added = await add(ctx, [], { all: true });
    expect(added.sort()).toEqual(["agents/rev", "mcp/notion", "packages/tk", "skills/beta"]);
    const y = await r(path.join(shed, "lshed.yaml"));
    expect(y).toContain("packages:\n  - id: tk\n    source: github:a/tk@");
    expect(y).toContain("    into: skills/tk\n    # install: ./setup");
    expect(y).toMatch(/default:\n[\s\S]*packages:\n      - tk/);
    expect((await readLock(shed)).packages.tk?.rev).toMatch(/^[0-9a-f]{40}$/);
    expect(await fs.access(path.join(shed, "skills/tk")).catch(() => "none")).toBe("none");
    expect(await fs.access(path.join(shed, "skills/stub")).catch(() => "none")).toBe("none");
    expect((await readState(ctx.adapter))?.managed).not.toContain("skills/tk");
    expect((await status(ctx)).fresh).toEqual([]);
    expect(logs.join("\n")).toContain("4개를 창고에 넣고");
  });

  it("이미 창고에 있는 것과 없는 것을 구분해 알려준다", async () => {
    await appear();
    await expect(add(ctx, ["alpha"])).rejects.toThrow(/이미 창고에 있습니다/);
    await expect(add(ctx, ["nope"])).rejects.toThrow(/로컬에서 찾지 못했습니다/);
  });

  it("창고에는 있지만 프로필이 안 쓰는 것은 힌트로만", async () => {
    const y = (await r(path.join(shed, "lshed.yaml"))).replace("    skills:\n      - alpha\n", "");
    await fs.writeFile(path.join(shed, "lshed.yaml"), y);
    await add(ctx);
    expect(logs.join("\n")).toContain('프로필 "default" 이 안 쓰는 것 1개: skills/alpha');
  });
});
