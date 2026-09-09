import { promises as fs } from "node:fs";
import type { AgentAdapter } from "../adapters/types.js";
import { adapterNames, createAdapter, DEFAULT_AGENT } from "../adapters/registry.js";
import { statePath } from "../state.js";

export interface AgentHere { name: string; root: string; exists: boolean; hasState: boolean }

/** 이 기기에 어느 에이전트 루트가 있고 어디에 lshed 상태가 있나. `--agent` 없이 불렀을 때의 근거. */
export async function agentsHere(make: (name: string) => AgentAdapter = (n) => createAdapter(n)): Promise<AgentHere[]> {
  const there = (p: string) => fs.access(p).then(() => true, () => false);
  return Promise.all(adapterNames().map(async (name) => {
    const a = make(name);
    return { name, root: a.root, exists: await there(a.root), hasState: await there(statePath(a)) };
  }));
}

/**
 * `--agent` 도 `LSHED_AGENT` 도 창고도 없을 때 어느 에이전트를 볼지. Claude Code 에 상태가 있으면 그것(예전 동작 그대로).
 * 없으면 상태가 있는 유일한 에이전트 — Codex 만 쓰는 기기에서 `restore --agent codex` 뒤의 `status`/`diff`/`save` 가 플래그 없이 그 루트를 보게.
 * 둘 이상이면 고르라고 한다. 아무 데도 없으면 undefined (기본값으로).
 */
export function agentByState(list: AgentHere[]): string | undefined {
  if (list.find((a) => a.name === DEFAULT_AGENT)?.hasState) return DEFAULT_AGENT;
  const withState = list.filter((a) => a.hasState);
  if (withState.length === 1) return withState[0].name;
  if (withState.length > 1) throw new Error(`More than one agent here has lshed state: ${withState.map((a) => a.name).join(", ")}. Say which: --agent <name> or LSHED_AGENT=<name>`);
  return undefined;
}

/** init 이 없는 루트를 조용히 훑고 빈 창고를 쓰지 않게: 루트가 없으면 있는 것들을 들어 `--agent` 를 권한다. */
export function missingRootMessage(agent: AgentHere, list: AgentHere[]): string {
  const others = list.filter((a) => a.exists && a.name !== agent.name);
  const hint = others.length
    ? `Found here: ${others.map((a) => `${a.name} (${a.root})`).join(", ")}.  Try: lshed init --agent ${others[0].name}`
    : `Pass --agent <${adapterNames().join("|")}> for the tool you use, or --root <dir> for its config folder.`;
  return `${agent.name}'s config root does not exist: ${agent.root}\n  ${hint}`;
}
