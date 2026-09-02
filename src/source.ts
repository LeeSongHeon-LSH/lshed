/**
 * 부품 출처(source) 식별자. v0.1부터 스킴을 강제한다 (§6.2).
 *   file:./skills/x
 *   github:user/repo@v1.0#path/in/repo
 */
export type Source =
  | { scheme: "file"; path: string }
  | { scheme: "github"; owner: string; repo: string; ref?: string; subpath?: string };

const GITHUB_RE = /^([\w.-]+)\/([\w.-]+)(?:@([^#]+))?(?:#(.+))?$/;

export function parseSource(raw: string): Source {
  const idx = raw.indexOf(":");
  if (idx <= 0) {
    throw new Error(`source에 스킴이 없습니다: "${raw}" (예: file:./skills/x, github:user/repo@v1)`);
  }
  const scheme = raw.slice(0, idx);
  const rest = raw.slice(idx + 1);
  switch (scheme) {
    case "file":
      if (!rest) throw new Error(`file: 뒤에 경로가 없습니다: "${raw}"`);
      return { scheme, path: rest };
    case "github": {
      const m = GITHUB_RE.exec(rest);
      if (!m) throw new Error(`github: 형식이 아닙니다: "${raw}" (예: github:user/repo@v1.0#sub/path)`);
      const [, owner, repo, ref, subpath] = m;
      return { scheme, owner, repo, ref, subpath };
    }
    default:
      throw new Error(`알 수 없는 스킴 "${scheme}": "${raw}"`);
  }
}

export function formatSource(s: Source): string {
  if (s.scheme === "file") return `file:${s.path}`;
  return `github:${s.owner}/${s.repo}${s.ref ? `@${s.ref}` : ""}${s.subpath ? `#${s.subpath}` : ""}`;
}
