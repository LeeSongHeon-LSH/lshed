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
    // CLAUDE_CONFIG_DIR 아래에서는 Claude Code 가 .claude.json 을 언제나 그 안에 만든다 — 아직 없는 새 기기라도 형제 파일을 쓰면 읽히지 않는다
    const insideOnly = !root && !!process.env.CLAUDE_CONFIG_DIR;
    this.entryCats = [
      /**
       * 사용자 범위 MCP (§7.4): ~/.claude 의 형제 ~/.claude.json 의 mcpServers. CLAUDE_CONFIG_DIR 처럼 루트 안에 있으면 그것.
       * Claude Code 가 ${VAR} 를 모든 범위에서 스스로 확장하므로 자리표시자를 그대로 둔다.
       */
      new JsonEntries({
        name: "mcp",
        file: async () => { const inside = path.join(root_, ".claude.json"); return insideOnly || (await exists(inside)) ? inside : `${root_}.json`; },
        under: "mcpServers",
        secretKeys: ["env", "headers"],
        expandsEnv: true,
      }),
      /**
       * settings.json (§7.6): 최상위 키 하나 = 항목 하나 (hooks, permissions, env, model, ...).
       * 병합하지 않는다. 키를 통째로 소유하고, 로컬 편집은 diff/save 로 되가져온다.
       * enabledPlugins 와 extraKnownMarketplaces 는 플러그인 설치기가 만드는 상태라 담지 않는다. ${VAR} 는 Claude Code 가 안 채우므로 restore 가 채운다.
       */
      new JsonEntries({
        name: "settings",
        file: async () => path.join(root_, "settings.json"),
        secretKeys: [],
        secretRootIds: ["env"],
        expandsEnv: false,
        skip: ["enabledPlugins", "extraKnownMarketplaces"],   // 둘 다 플러그인 설치기가 쓰는 상태: 마켓플레이스·플러그인 패키지가 restore 로 되살린다
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
      // 스킬은 skills/<name>/SKILL.md 한 단계다. agents/commands 는 Claude Code 가 하위 디렉터리를 재귀적으로 읽으므로
      // 그대로 따라간다. id 는 루트 기준 상대 경로(POSIX, 확장자 제외)라 사용자의 폴더 정리가 창고에도 보존된다.
      await this.walk(cat, path.join(this.root, cat.root), "", out);
    }
    return out;
  }

  private async walk(cat: Category, dir: string, rel: string, out: ScannedComponent[]): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 카테고리 디렉터리가 없으면 비어 있는 것
    }
    // readdir 순서는 파일 시스템마다 다르다. 매니페스트는 git 에 들어가므로 기기와 무관해야 한다.
    // localeCompare 는 로케일을 타므로 쓰지 않는다.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      const id = rel ? `${rel}/${e.name}` : e.name;
      // 심볼릭 링크로 걸린 부품도 잡아야 하므로 Dirent 대신 stat 으로 판정한다
      let st: import("node:fs").Stats;
      try {
        st = await fs.stat(full);
      } catch {
        continue; // 끊어진 링크
      }
      if (cat.kind === "dir") {
        if (st.isDirectory()) out.push({ category: cat.name, id, path: full });
      } else if (st.isDirectory()) {
        await this.walk(cat, full, id, out);
      } else if (st.isFile() && e.name.endsWith(".md")) {
        out.push({ category: cat.name, id: id.slice(0, -3), path: full });
      }
    }
  }
}
