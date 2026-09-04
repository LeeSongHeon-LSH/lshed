import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentAdapter, Category, EntryCategory, ScannedComponent } from "./types.js";

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
  /** 스킬을 하위 디렉터리까지 재귀적으로 읽는 도구 (Codex, Cursor). 스캔은 어디서든 한 단계만 본다 */
  note?: string;
}

const SKILLS: Category = { name: "skills", root: "skills", kind: "dir" };

export class SkillsDirAdapter implements AgentAdapter {
  readonly name: string;
  readonly root: string;
  constructor(private readonly spec: SkillsDirSpec, root?: string) {
    this.name = spec.name;
    this.root = root ?? (spec.envVar && process.env[spec.envVar]) ?? path.join(os.homedir(), spec.dir);
  }
  categories(): readonly Category[] { return [SKILLS]; }
  entries(): readonly EntryCategory[] { return []; }
  installers() { return []; }
  instructionsStrategy() { return this.spec.instructions?.strategy ?? "concat"; }
  instructionsFileName() { return this.spec.instructions?.file ?? null; }

  /** skills/<name>/ 한 단계. 숨김 디렉터리는 건너뛴다. 링크도 stat 으로 판정해 잡는다. */
  async scan(): Promise<ScannedComponent[]> {
    const dir = path.join(this.root, SKILLS.root);
    let names: string[];
    try { names = await fs.readdir(dir); } catch { return []; }
    names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const out: ScannedComponent[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try { if (!(await fs.stat(full)).isDirectory()) continue; } catch { continue; }
      out.push({ category: SKILLS.name, id: name, path: full });
    }
    return out;
  }
}

/**
 * 지원 도구. 경로는 각 도구 문서 기준 (2026-09 확인):
 *  - codex: $CODEX_HOME 또는 ~/.codex, 전역 지침 AGENTS.md (import 문법 없음 → 이어붙임)
 *  - gemini: ~/.gemini, GEMINI.md 는 @import 를 지원하지만 허용 디렉터리 제한이 문서에 불명확해 이어붙임
 *  - copilot: $COPILOT_HOME 또는 ~/.copilot, copilot-instructions.md (@import 는 저장소 안에서만 → 이어붙임)
 *  - cursor: ~/.cursor, 사용자 규칙은 설정 UI 에만 있어 지침 파일 없음
 *  - agents: ~/.agents — 위 도구 전부가 함께 읽는 공용 위치. 지침 파일 없음
 */
export const SKILLS_DIR_AGENTS: readonly SkillsDirSpec[] = [
  { name: "codex", envVar: "CODEX_HOME", dir: ".codex", instructions: { file: "AGENTS.md", strategy: "concat" } },
  { name: "gemini", dir: ".gemini", instructions: { file: "GEMINI.md", strategy: "concat" } },
  { name: "copilot", envVar: "COPILOT_HOME", dir: ".copilot", instructions: { file: "copilot-instructions.md", strategy: "concat" } },
  { name: "cursor", dir: ".cursor" },
  { name: "agents", dir: ".agents" },
];
