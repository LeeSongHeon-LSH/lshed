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
  git(["clone", "--quiet", ...(ref ? ["--branch", ref] : []), url, dir]);
export const resetHard = (dir: string, sha: string) => git(["reset", "--hard", "--quiet", sha], dir);
export const pullFf = (dir: string) => git(["pull", "--ff-only", "--quiet"], dir);

/** 설치 명령 실행. 출력은 그대로 터미널로 흘린다. */
export function runShell(cmd: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("sh", ["-c", cmd], { cwd, stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`명령이 ${code} 로 끝났습니다: ${cmd}`))));
  });
}
