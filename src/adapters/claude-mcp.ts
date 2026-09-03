import { promises as fs } from "node:fs";
import path from "node:path";
import type { EntryCategory } from "./types.js";
import { exists } from "../fsutil.js";

/**
 * Claude Code 의 사용자 범위 MCP 서버 (§7.4).
 * ~/.claude.json 의 mcpServers 키에 machineID·세션 기록 등과 함께 들어 있다.
 * 그 키만 읽고 쓰며, 파일은 임시 파일 → rename 으로 통째로 바꾼다.
 * Claude Code 가 ${VAR} 를 모든 범위에서 스스로 확장하므로 자리표시자를 그대로 둔다.
 */
export class ClaudeMcpEntries implements EntryCategory {
  readonly name = "mcp";
  readonly kind = "entry" as const;
  readonly secretKeys = ["env", "headers"] as const;
  readonly expandsEnv = true;

  constructor(private readonly root: string) {}

  /** ~/.claude 의 형제 ~/.claude.json. CLAUDE_CONFIG_DIR 처럼 루트 안에 있으면 그것을 쓴다. */
  async file(): Promise<string> {
    const inside = path.join(this.root, ".claude.json");
    return (await exists(inside)) ? inside : `${this.root}.json`;
  }

  private async load(): Promise<Record<string, unknown>> {
    const p = await this.file();
    try {
      return JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(`${p} 을 읽을 수 없습니다: ${(e as Error).message}`);
    }
  }

  async read(): Promise<Record<string, unknown>> {
    const servers = (await this.load()).mcpServers;
    return servers && typeof servers === "object" ? { ...(servers as Record<string, unknown>) } : {};
  }

  async write(id: string, value: unknown | null): Promise<void> {
    const p = await this.file();
    const all = await this.load();
    const servers = { ...((all.mcpServers as Record<string, unknown> | undefined) ?? {}) };
    if (value === null) delete servers[id];
    else servers[id] = value;
    all.mcpServers = servers;
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.lshed-${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(all, null, 2) + "\n");
    await fs.rename(tmp, p);
  }
}
