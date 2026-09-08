import path from "node:path";
import { parseSource } from "../source.js";

/**
 * source 문자열 → 창고 안의 절대 경로.
 * v0.1은 file: 만 지원한다 (§6.1). 원격 스킴은 v0.2.
 */
export function resolveSource(shed: string, raw: string): string {
  const s = parseSource(raw);
  if (s.scheme === "file") return path.resolve(shed, s.path);
  throw new Error(`"${raw}": ${s.scheme}: sources for parts come in a later version. Only file: works today.`);
}

export function isSaveable(raw: string): boolean {
  return parseSource(raw).scheme === "file";
}
