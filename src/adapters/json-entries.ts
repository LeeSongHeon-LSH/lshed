import { promises as fs } from "node:fs";
import path from "node:path";
import type { EntryCategory } from "./types.js";

export interface JsonEntriesSpec {
  name: string;
  /** 설정 파일 경로. 없으면 빈 것으로 본다 */
  file: () => Promise<string>;
  /** 항목들이 사는 키. 없으면 파일 최상위가 항목 맵이다 */
  under?: string;
  secretKeys: readonly string[];
  secretRootIds?: readonly string[];
  expandsEnv: boolean;
  /** 다른 것이 관리하는 키. 담지 않는다 (예: enabledPlugins 는 플러그인 설치기 몫) */
  skip?: readonly string[];
}

/**
 * JSON 파일 안의 키 하나 = 항목 하나. 그 키만 읽고 쓰며, 다른 키는 그대로 둔다.
 * 파일은 임시 파일 → rename 으로 통째로 바꾼다. Claude Code 의 ~/.claude.json(mcpServers) 과 settings.json 이 이 형태다.
 */
export class JsonEntries implements EntryCategory {
  readonly kind = "entry" as const;
  readonly name: string;
  readonly secretKeys: readonly string[];
  readonly secretRootIds?: readonly string[];
  readonly expandsEnv: boolean;

  constructor(private readonly spec: JsonEntriesSpec) {
    this.name = spec.name;
    this.secretKeys = spec.secretKeys;
    this.secretRootIds = spec.secretRootIds;
    this.expandsEnv = spec.expandsEnv;
  }

  file(): Promise<string> { return this.spec.file(); }

  private async load(): Promise<Record<string, unknown>> {
    const p = await this.file();
    try {
      return JSON.parse(await fs.readFile(p, "utf8")) as Record<string, unknown>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(`${p} 을 읽을 수 없습니다: ${(e as Error).message}`);
    }
  }

  private section(all: Record<string, unknown>): Record<string, unknown> {
    const s = this.spec.under ? all[this.spec.under] : all;
    return s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
  }

  async read(): Promise<Record<string, unknown>> {
    const out = { ...this.section(await this.load()) };
    for (const k of this.spec.skip ?? []) delete out[k];
    return out;
  }

  async write(id: string, value: unknown | null): Promise<void> {
    const p = await this.file();
    const all = await this.load();
    const sect = { ...this.section(all) };
    if (value === null) delete sect[id];
    else sect[id] = value;
    const next = this.spec.under ? { ...all, [this.spec.under]: sect } : sect;
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.lshed-${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
    await fs.rename(tmp, p);
  }
}
