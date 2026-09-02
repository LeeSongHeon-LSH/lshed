import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "../src/adapters/claude-code.js";

describe("ClaudeCodeAdapter.scan (임시 루트 주입)", () => {
  it("skills 디렉터리·agents/commands md 파일을 찾고 숨김·비md는 무시", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-"));
    await fs.mkdir(path.join(root, "skills", "a"), { recursive: true });
    await fs.mkdir(path.join(root, "skills", ".hidden"), { recursive: true });
    await fs.mkdir(path.join(root, "agents"), { recursive: true });
    await fs.writeFile(path.join(root, "agents", "rev.md"), "");
    await fs.writeFile(path.join(root, "agents", "notes.txt"), "");
    // commands 디렉터리 없음 → 빈 것으로 취급
    const found = await new ClaudeCodeAdapter(root).scan();
    expect(found.map((c) => `${c.category}/${c.id}`).sort()).toEqual(["agents/rev", "skills/a"]);
    await fs.rm(root, { recursive: true });
  });
});
