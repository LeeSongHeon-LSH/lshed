/**
 * 창고에 담지 않을 경로.
 *
 * 기본값은 "패키지 매니저가 언제든 다시 만들어 주는 것"만 담는다.
 * `dist` 같은 빌드 산출물은 스킬에 따라 그 자체가 실행에 필요하므로 기본값에 넣지 않는다.
 * 무거운 부품은 `lshed init --exclude <pattern>` 이나 매니페스트의 `ignore:` 로 사용자가 정한다.
 */
export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  ".mypy_cache",
  ".pytest_cache",
  ".DS_Store",
  "*.log",
] as const;

/** 패턴 하나가 이름과 맞는지. `*.ext` 형태의 단순 글롭만 지원한다. */
function matches(name: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) return name.endsWith(pattern.slice(1));
  return name === pattern;
}

/** 상대 경로(POSIX)가 무시 대상인지. 경로의 어느 구간이든 걸리면 무시한다. */
export function isIgnored(rel: string, patterns: readonly string[]): boolean {
  if (!rel) return false;
  return rel.split("/").some((seg) => patterns.some((p) => matches(seg, p)));
}
