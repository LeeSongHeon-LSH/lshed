import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentAdapter, Category, EntryCategory, ScannedComponent } from "./types.js";
import { JsonEntries } from "./json-entries.js";
import { TomlEntries } from "./toml-entries.js";
import { MCP_FORMS, type McpForm } from "./mcp-forms.js";

/**
 * Agent Skills 표준(agentskills.io)을 따르는 에이전트들의 공통 어댑터 (§4.6).
 * 전부 `<root>/skills/<name>/SKILL.md` 한 가지 규약을 쓰고, 루트와 사용자 지침 파일만 다르다.
 * 항목형(MCP, settings)은 도구마다 형식이 달라 여기서는 다루지 않는다 — 그 카테고리는 restore 가 건너뛰며 알린다.
 */
export interface SkillsDirSpec {
  name: string;
  /** 설정 루트. 환경변수가 있으면 그것, 아니면 홈 아래 디렉터리 */
  envVar?: string;
  dir: string;
  /** 사용자 수준 지침 파일. 없으면 instructions 카테고리를 지원하지 않는다 */
  instructions?: { file: string; strategy: "import" | "concat" };
  /**
   * 사용자 수준 MCP 서버 설정. 창고 형식(Claude Code 의 것)과 이 도구 형식 사이는 mcp-forms 가 바꾼다.
   * expandsEnv: 도구가 "${VAR}" 를 스스로 채우거나(cursor 는 ${env:VAR} 로, codex 는 env_vars 로 표현) 아니면 restore 가 채운다.
   */
  mcp?: { file: string; kind: "json" | "toml"; under: string; form: McpForm; expandsEnv: boolean };
  /**
   * 스킬을 루트가 아니라 홈 아래 이 경로에 둔다 (Codex: 문서상 사용자 스킬 위치는 `~/.agents/skills`, `$CODEX_HOME/skills` 는 deprecated).
   * 카테고리 루트는 어댑터 루트 기준 상대 경로가 되므로 `../.agents/skills` 처럼 위로 올라간다.
   */
  skillsHome?: string;
  /** 스킬을 하위 디렉터리까지 재귀적으로 읽는 도구 (Codex, Cursor). 스캔은 어디서든 한 단계만 본다 */
  note?: string;
}

const SKILLS: Category = { name: "skills", root: "skills", kind: "dir" };

export class SkillsDirAdapter implements AgentAdapter {
  readonly name: string;
  readonly root: string;
  private readonly skills: Category;
  /**
   * root 를 주면 기본 위치 대신 그것 (테스트·--root). home 은 skillsHome 의 기준으로, 루트를 준 경우 기본은 그 부모
   * (임시 루트로 돌리는 테스트가 진짜 홈에 쓰지 않도록), 아니면 실제 홈.
   */
  constructor(private readonly spec: SkillsDirSpec, root?: string, home?: string) {
    this.name = spec.name;
    this.root = root ?? (spec.envVar && process.env[spec.envVar]) ?? path.join(os.homedir(), spec.dir);
    if (spec.skillsHome) {
      const base = home ?? (root ? path.dirname(root) : os.homedir());
      const rel = path.relative(this.root, path.join(base, spec.skillsHome)).split(path.sep).join("/");
      this.skills = { ...SKILLS, root: rel };
    } else this.skills = SKILLS;
    const m = spec.mcp;
    if (!m) { this.entryCats = []; return; }
    const form = MCP_FORMS[m.form];
    const file = async () => path.join(this.root, m.file);
    const common = { name: "mcp", file, under: m.under, secretKeys: ["env", "headers"], expandsEnv: m.expandsEnv, toLocal: (_id: string, v: import("../core/entries.js").Json) => form.toLocal(v), fromLocal: (_id: string, v: import("../core/entries.js").Json) => form.fromLocal(v) };
    this.entryCats = [m.kind === "toml" ? new TomlEntries(common) : new JsonEntries(common)];
  }
  categories(): readonly Category[] { return [this.skills]; }
  entries(): readonly EntryCategory[] { return this.entryCats; }
  private readonly entryCats: readonly EntryCategory[];
  installers() { return []; }
  instructionsStrategy() { return this.spec.instructions?.strategy ?? "concat"; }
  instructionsFileName() { return this.spec.instructions?.file ?? null; }

  /** skills/<name>/ 한 단계. 숨김 디렉터리는 건너뛴다. 링크도 stat 으로 판정해 잡는다. */
  async scan(): Promise<ScannedComponent[]> {
    const dir = path.join(this.root, this.skills.root);
    let names: string[];
    try { names = await fs.readdir(dir); } catch { return []; }
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: ScannedComponent[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try { if (!(await fs.stat(full)).isDirectory()) continue; } catch { continue; }
      out.push({ category: this.skills.name, id: name, path: full });
    }
    return out;
  }
}

/**
 * 지원 도구. 경로는 각 도구 문서 기준 (2026-09 확인). MCP 파일: codex config.toml [mcp_servers], gemini settings.json,
 * copilot mcp-config.json, cursor mcp.json (모두 mcpServers). ~/.agents 에는 MCP 규약이 없다.
 *  - codex: $CODEX_HOME 또는 ~/.codex 에 AGENTS.md (import 문법 없음 → 이어붙임)·config.toml. 스킬은 ~/.agents/skills —
 *    Codex 0.153 이 $CODEX_HOME/skills 도 읽지만 소스에 deprecated 로 적혀 있고 문서는 .agents/skills 만 말한다 (2026-09-05 실측)
 *  - gemini: ~/.gemini, GEMINI.md 는 @import 를 지원하지만 허용 디렉터리 제한이 문서에 불명확해 이어붙임
 *  - copilot: $COPILOT_HOME 또는 ~/.copilot, copilot-instructions.md (@import 는 저장소 안에서만 → 이어붙임)
 *  - cursor: ~/.cursor, 사용자 규칙은 설정 UI 에만 있어 지침 파일 없음
 *  - agy: ~/.gemini/config (Antigravity IDE·CLI 공용), 규칙은 ../AGENTS.md, MCP 는 mcp_config.json (http 는 serverUrl)
 *  - agents: ~/.agents — 위 도구 전부가 함께 읽는 공용 위치. 지침 파일 없음
 */
export const SKILLS_DIR_AGENTS: readonly SkillsDirSpec[] = [
  { name: "codex", envVar: "CODEX_HOME", dir: ".codex", skillsHome: ".agents/skills", instructions: { file: "AGENTS.md", strategy: "concat" },
    mcp: { file: "config.toml", kind: "toml", under: "mcp_servers", form: "codex", expandsEnv: true } },
  { name: "gemini", dir: ".gemini", instructions: { file: "GEMINI.md", strategy: "concat" },
    // env 블록은 $VAR 를 스스로 채우지만 headers 는 아니라서, 일관되게 restore 가 채운다
    mcp: { file: "settings.json", kind: "json", under: "mcpServers", form: "gemini", expandsEnv: false } },
  { name: "copilot", envVar: "COPILOT_HOME", dir: ".copilot", instructions: { file: "copilot-instructions.md", strategy: "concat" },
    mcp: { file: "mcp-config.json", kind: "json", under: "mcpServers", form: "copilot", expandsEnv: false } },
  { name: "cursor", dir: ".cursor", mcp: { file: "mcp.json", kind: "json", under: "mcpServers", form: "cursor", expandsEnv: true } },
  // Antigravity (agy CLI + IDE): ~/.gemini/config 이 IDE·CLI 가 함께 읽는 곳(skills, mcp_config.json). 전역 규칙은 한 단계 위 ~/.gemini 의
  // AGENTS.md 또는 GEMINI.md — Gemini CLI 도 GEMINI.md 를 쓰므로(충돌 보고됨) AGENTS.md 를 쓴다. 둘 다 읽음은 agy 1.1.26 에 물어 확인.
  { name: "agy", dir: ".gemini/config", instructions: { file: "../AGENTS.md", strategy: "concat" },
    mcp: { file: "mcp_config.json", kind: "json", under: "mcpServers", form: "agy", expandsEnv: false } },
  { name: "agents", dir: ".agents" },
];
