import type { AgentAdapter } from "./types.js";
import { ClaudeCodeAdapter } from "./claude-code.js";
import { SkillsDirAdapter, SKILLS_DIR_AGENTS } from "./skills-dir.js";

export const DEFAULT_AGENT = "claude-code";

export function adapterNames(): string[] {
  return [DEFAULT_AGENT, ...SKILLS_DIR_AGENTS.map((s) => s.name)];
}

/** 이름으로 어댑터를 만든다. root 를 주면 기본 위치 대신 그것 (테스트·--root). */
export function createAdapter(name: string, root?: string): AgentAdapter {
  if (name === DEFAULT_AGENT) return new ClaudeCodeAdapter(root);
  const spec = SKILLS_DIR_AGENTS.find((s) => s.name === name);
  if (!spec) throw new Error(`모르는 에이전트 "${name}". 지원: ${adapterNames().join(", ")}`);
  return new SkillsDirAdapter(spec, root);
}
