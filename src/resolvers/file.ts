import path from "node:path";
import { parseSource } from "../source.js";

/**
 * source 문자열 → 창고 안의 절대 경로.
 * 부품은 file: 만 된다 (§6.1). 원격 코드는 리졸버가 아니라 패키지 설치기가 다룬다 (§7.5).
 * parseManifest 가 먼저 거르므로 아래 오류는 방어용이다.
 */
export function resolveSource(shed: string, raw: string): string {
  const s = parseSource(raw);
  if (s.scheme === "file") return path.resolve(shed, s.path);
  throw new Error(`"${raw}": ${s.scheme}: a part's source must be file: (put github:/git: code under packages:)`);
}

export function isSaveable(raw: string): boolean {
  return parseSource(raw).scheme === "file";
}
