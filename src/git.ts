import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { exists } from "./fsutil.js";

const x = promisify(execFile);

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await x("git", args, { cwd, maxBuffer: 1 << 24 });
  return stdout.trim();
}

export const isRepo = (dir: string) => exists(path.join(dir, ".git"));
export const remoteUrl = (dir: string) => git(["remote", "get-url", "origin"], dir).catch(() => null);
export const head = (dir: string) => git(["rev-parse", "HEAD"], dir);
/** 분리(detached) 상태면 undefined */
export const branch = async (dir: string) => {
  const b = await git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  return b === "HEAD" ? undefined : b;
};
export const clone = (url: string, dir: string, ref?: string) =>
  // url·dir 은 `--` 뒤 위치인자로, ref 는 `--branch=` 로 값에 묶어 준다. `-` 로 시작하는 값이 git 옵션으로 새는 것을 막는다.
  git(["clone", "--quiet", ...(ref ? [`--branch=${ref}`] : []), "--", url, dir]);
export const resetHard = (dir: string, sha: string) => git(["reset", "--hard", "--quiet", sha], dir);
export const pullFf = (dir: string) => git(["pull", "--ff-only", "--quiet"], dir);

/**
 * 원격의 커밋을 clone 없이 읽는다 (`git ls-remote`). ref 가 없으면 HEAD.
 * 같은 이름의 브랜치와 태그가 있으면 브랜치, 주석 태그는 가리키는 커밋(^{}) 을 택한다.
 */
export async function lsRemote(url: string, ref?: string): Promise<string> {
  // 이름만 주면 git 이 peeled(^{}) 줄을 빼므로 셋을 전부 명시한다
  const want = ref ? [`refs/heads/${ref}`, `refs/tags/${ref}^{}`, `refs/tags/${ref}`] : ["HEAD"];
  // `--` 뒤로 url 을 넘겨 `-` 로 시작하는 url 이 git 옵션(예: --upload-pack)으로 해석되지 않게 한다.
  const out = await git(["ls-remote", "--", url, ...want]);
  const lines = out.split("\n").filter(Boolean).map((l) => { const [sha, name] = l.split("\t"); return { sha, name }; });
  if (!lines.length) throw new Error(`${url} has no ${ref ?? "HEAD"}`);
  for (const w of want) { const hit = lines.find((l) => l.name === w); if (hit) return hit.sha; }
  return lines[0].sha;
}

/** 설치 명령 실행. 출력은 그대로 터미널로 흘린다. 셸은 플랫폼 기본값 (sh / cmd.exe). */
export function runShell(cmd: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, { cwd, stdio: "inherit", shell: true });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`command exited with ${code}: ${cmd}`))));
  });
}
