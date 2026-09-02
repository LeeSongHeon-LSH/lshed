import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AgentAdapter } from "./adapters/types.js";

/** 기기별 상태 (§3.5). 어댑터 루트 아래 lshed/state.json. 창고에는 들어가지 않는다. */
export const StateSchema = z.object({
  profile: z.string(),
  shed: z.string(),
  /** 어댑터 루트 기준 상대 경로 (POSIX 구분자). lshed가 놓은 것만. */
  managed: z.array(z.string()),
  appliedAt: z.string(),
});
export type State = z.infer<typeof StateSchema>;

export const LSHED_DIR = "lshed";

export function statePath(adapter: AgentAdapter): string {
  return path.join(adapter.root, LSHED_DIR, "state.json");
}

export async function readState(adapter: AgentAdapter): Promise<State | null> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(adapter), "utf8"));
    return StateSchema.parse(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`state.json 을 읽을 수 없습니다 (${statePath(adapter)}): ${(e as Error).message}`);
  }
}

export async function writeState(adapter: AgentAdapter, state: State): Promise<void> {
  const p = statePath(adapter);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(state, null, 2) + "\n");
}
