import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentAdapter, Category, ScannedComponent } from "./types.js";

const CATEGORIES: readonly Category[] = [
  { name: "skills", root: "skills", kind: "dir" },
  { name: "agents", root: "agents", kind: "file" },
  { name: "commands", root: "commands", kind: "file" },
  // instructions 는 단일 파일(CLAUDE.md)이라 스캔 대상이 아니라 생성 대상이다 (§3.3)
];

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  readonly root: string;

  constructor(root?: string) {
    this.root = root ?? path.join(os.homedir(), ".claude");
  }

  categories() {
    return CATEGORIES;
  }

  instructionsStrategy() {
    return "import" as const;
  }

  instructionsFileName() {
    return "CLAUDE.md";
  }

  async scan(): Promise<ScannedComponent[]> {
    const out: ScannedComponent[] = [];
    for (const cat of CATEGORIES) {
      const dir = path.join(this.root, cat.root);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue; // 카테고리 디렉터리가 없으면 비어 있는 것
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        if (cat.kind === "dir" && e.isDirectory()) {
          out.push({ category: cat.name, id: e.name, path: path.join(dir, e.name) });
        } else if (cat.kind === "file" && e.isFile() && e.name.endsWith(".md")) {
          out.push({ category: cat.name, id: e.name.slice(0, -3), path: path.join(dir, e.name) });
        }
      }
    }
    return out;
  }
}
