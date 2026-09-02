import path from "node:path";
import { parseSource } from "../source.js";

/**
 * source 문자열 → 창고 안의 절대 경로.
 * v0.1은 file: 만 지원한다 (§6.1). 원격 스킴은 v0.2.
 */
export function resolveSource(shed: string, raw: string): string {
  const s = parseSource(raw);
  if (s.scheme === "file") return path.resolve(shed, s.path);
  throw new Error(`"${raw}": ${s.scheme}: 출처는 v0.2에서 지원됩니다. 지금은 file: 만 사용할 수 있습니다.`);
}

export function isSaveable(raw: string): boolean {
  return parseSource(raw).scheme === "file";
}
