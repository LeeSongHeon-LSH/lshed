import { promises as fs } from "node:fs";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type { EntryCategory } from "./types.js";
import type { Json } from "../core/entries.js";

export interface TomlEntriesSpec {
  name: string;
  file: () => Promise<string>;
  /** 항목들이 사는 표. 예: mcp_servers → [mcp_servers.<id>] */
  under: string;
  secretKeys: readonly string[];
  expandsEnv: boolean;
  toLocal?: (id: string, v: Json) => Json;
  fromLocal?: (id: string, v: Json) => Json;
}

/**
 * TOML 파일 안의 [<under>.<id>] 표 하나 = 항목 하나 (Codex config.toml).
 * 읽기는 파서로, 쓰기는 그 항목의 표 블록만 잘라내고 다시 붙이는 텍스트 편집이다 — 파일을 통째로 다시 찍으면
 * 사용자의 주석과 순서가 사라지기 때문이다. 다른 표는 한 글자도 바뀌지 않는다.
 */
export class TomlEntries implements EntryCategory {
  readonly kind = "entry" as const;
  readonly name: string;
  readonly secretKeys: readonly string[];
  readonly expandsEnv: boolean;

  constructor(private readonly spec: TomlEntriesSpec) {
    this.name = spec.name;
    this.secretKeys = spec.secretKeys;
    this.expandsEnv = spec.expandsEnv;
  }

  file(): Promise<string> { return this.spec.file(); }

  private async text(): Promise<string> {
    try { return await fs.readFile(await this.file(), "utf8"); } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw new Error(`${await this.file()} 을 읽을 수 없습니다: ${(e as Error).message}`);
    }
  }

  async read(): Promise<Record<string, unknown>> {
    const t = await this.text();
    let all: Record<string, unknown>;
    try { all = parse(t) as Record<string, unknown>; } catch (e) { throw new Error(`${await this.file()}: TOML 을 읽을 수 없습니다: ${(e as Error).message}`); }
    const sect = all[this.spec.under];
    if (!sect || typeof sect !== "object" || Array.isArray(sect)) return {};
    const out: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(sect as Record<string, unknown>)) out[id] = this.spec.fromLocal ? this.spec.fromLocal(id, v as Json) : v;
    return out;
  }

  async write(id: string, value: unknown | null): Promise<void> {
    const p = await this.file();
    let t = removeBlock(await this.text(), this.spec.under, id);
    if (value !== null) {
      const local = this.spec.toLocal ? this.spec.toLocal(id, value as Json) : (value as Json);
      const block = stringify({ [this.spec.under]: { [id]: local } }).trimEnd() + "\n";
      t = (t.length && !t.endsWith("\n") ? t + "\n" : t) + (t.trim().length ? "\n" : "") + block;
    }
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.lshed-${process.pid}.tmp`;
    await fs.writeFile(tmp, t);
    await fs.rename(tmp, p);
  }
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * [under.id] 와 그 하위 표([under.id.env] 등) 블록을 지운다. 블록은 헤더 줄부터 다음 헤더 줄 직전까지.
 * [under] 표 안에 `id = { ... }` 인라인 표로 적힌 경우도 그 줄을 지운다.
 */
export function removeBlock(text: string, under: string, id: string): string {
  const lines = text.split("\n");
  const head = new RegExp(`^\\s*\\[\\s*${esc(under)}\\s*\\.\\s*("?)${esc(id)}\\1(\\s*\\.[^\\]]*)?\\s*\\]`);
  const anyHead = /^\s*\[/;
  const underHead = new RegExp(`^\\s*\\[\\s*${esc(under)}\\s*\\]`);
  const inline = new RegExp(`^\\s*("?)${esc(id)}\\1\\s*=`);
  const out: string[] = [];
  let skipping = false, inUnder = false;
  for (const line of lines) {
    if (anyHead.test(line)) { skipping = head.test(line); inUnder = underHead.test(line); if (skipping) continue; }
    if (skipping) continue;
    if (inUnder && inline.test(line)) continue;
    out.push(line);
  }
  // 블록을 지우며 생긴 빈 줄 뭉치는 하나로
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
