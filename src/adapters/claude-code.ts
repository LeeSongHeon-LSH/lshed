import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentAdapter, Category, EntryCategory, ScannedComponent } from "./types.js";
import { marketplaceInstaller, pluginInstaller } from "../installers/claude-plugin.js";
import { JsonEntries } from "./json-entries.js";
import { exists } from "../fsutil.js";

const CATEGORIES: readonly Category[] = [
  { name: "skills", root: "skills", kind: "dir" },
  { name: "agents", root: "agents", kind: "file" },
  { name: "commands", root: "commands", kind: "file" },
  // instructions 는 단일 파일(CLAUDE.md)이라 스캔 대상이 아니라 생성 대상이다 (§3.3)
];

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = "claude-code";
  readonly root: string;
  private readonly entryCats: readonly EntryCategory[];

  constructor(root?: string) {
    // Claude Code 는 CLAUDE_CONFIG_DIR 가 있으면 설정 전체(.claude.json 포함)를 그 안에 둔다
    this.root = root ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
    const root_ = this.root;
    this.entryCats = [
      /**
       * 사용자 범위 MCP (§7.4): ~/.claude 의 형제 ~/.claude.json 의 mcpServers. CLAUDE_CONFIG_DIR 처럼 루트 안에 있으면 그것.
       * Claude Code 가 ${VAR} 를 모든 범위에서 스스로 확장하므로 자리표시자를 그대로 둔다.
       */
      new JsonEntries({
        name: "mcp",
        file: async () => { const inside = path.join(root_, ".claude.json"); return (await exists(inside)) ? inside : `${root_}.json`; },
        under: "mcpServers",
        secretKeys: ["env", "headers"],
        expandsEnv: true,
      }),
      /**
       * settings.json (§7.6): 최상위 키 하나 = 항목 하나 (hooks, permissions, env, model, ...).
       * 병합하지 않는다. 키를 통째로 소유하고, 로컬 편집은 diff/save 로 되가져온다.
       * enabledPlugins 는 플러그인 설치기가 만드는 상태라 담지 않는다. ${VAR} 는 Claude Code 가 안 채우므로 restore 가 채운다.
       */
      new JsonEntries({
        name: "settings",
        file: async () => path.join(root_, "settings.json"),
        secretKeys: [],
        secretRootIds: ["env"],
        expandsEnv: false,
        skip: ["enabledPlugins"],
      }),
    ];
  }

  entries() {
    return this.entryCats;
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

  installers() {
    return [marketplaceInstaller, pluginInstaller];
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
        const full = path.join(dir, e.name);
        // 심볼릭 링크로 걸린 부품도 잡아야 하므로 Dirent 대신 stat 으로 판정한다
        let st: import("node:fs").Stats;
        try {
          st = await fs.stat(full);
        } catch {
          continue; // 끊어진 링크
        }
        if (cat.kind === "dir" && st.isDirectory()) {
          out.push({ category: cat.name, id: e.name, path: full });
        } else if (cat.kind === "file" && st.isFile() && e.name.endsWith(".md")) {
          out.push({ category: cat.name, id: e.name.slice(0, -3), path: full });
        }
      }
    }
    return out;
  }
}
