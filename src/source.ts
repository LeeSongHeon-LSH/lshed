/**
 * 부품·패키지 출처(source) 식별자. v0.1부터 스킴을 강제한다 (§6.2).
 *   file:./skills/x
 *   github:owner/repo@ref#path/in/repo
 *   git:<url>#ref                      (github 이 아닌 git 원격. URL 에 # 은 못 오므로 # 으로 ref 를 나눈다)
 */
export type Source =
  | { scheme: "file"; path: string }
  | { scheme: "github"; owner: string; repo: string; ref?: string; subpath?: string }
  | { scheme: "git"; url: string; ref?: string };

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
    case "git": {
      const hash = rest.lastIndexOf("#");
      const url = hash >= 0 ? rest.slice(0, hash) : rest;
      const ref = hash >= 0 ? rest.slice(hash + 1) : undefined;
      if (!url) throw new Error(`git: 뒤에 URL 이 없습니다: "${raw}"`);
      return { scheme, url, ref: ref || undefined };
    }
    default:
      throw new Error(`알 수 없는 스킴 "${scheme}": "${raw}"`);
  }
}

export function formatSource(s: Source): string {
  switch (s.scheme) {
    case "file": return `file:${s.path}`;
    case "github": return `github:${s.owner}/${s.repo}${s.ref ? `@${s.ref}` : ""}${s.subpath ? `#${s.subpath}` : ""}`;
    case "git": return `git:${s.url}${s.ref ? `#${s.ref}` : ""}`;
  }
}

/** clone 에 쓸 URL 과 ref. file: 은 해당 없음. */
export function cloneTarget(s: Source): { url: string; ref?: string } {
  if (s.scheme === "github") return { url: `https://github.com/${s.owner}/${s.repo}.git`, ref: s.ref };
  if (s.scheme === "git") return { url: s.url, ref: s.ref };
  throw new Error(`file: 출처는 clone 대상이 아닙니다`);
}

/** 기존 clone 의 origin URL + 브랜치 → source 문자열. GitHub 이면 github: 로 줄인다. */
export function sourceFromRemote(url: string, ref?: string): string {
  const m = /^(?:https?:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
  if (m) return formatSource({ scheme: "github", owner: m[1], repo: m[2], ref });
  return formatSource({ scheme: "git", url, ref });
}
