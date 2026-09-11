import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../src/git.js";

/** 던진 오류를 잡아 온다 (던지지 않으면 그것 자체가 실패다) */
async function failure(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return (e as Error).message; }
  throw new Error("expected git to fail");
}

// 사용자가 보는 것은 이 한 줄이다. 0.17.3 까지는 "Command failed: git clone --quiet -- <url> <dir>" 만 나와서
// 왜 실패했는지(없는 저장소인지, 권한인지, 네트워크인지)를 알 수 없었다.
// git 의 문장 자체는 버전·OS 마다 다르므로(Windows 는 없는 경로에도 "does not appear to be a git repository")
// 여기서 고정하는 것은 영어가 아니라 모양이다: 어느 명령이 죽었는지, 이유가 실려 있는지, 군더더기가 없는지.
describe("git 오류 메시지", () => {
  it("clone: 명령 이름과 git 이 말한 이유를 싣는다", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-git-"));
    const msg = await failure(git(["clone", "--quiet", "--", path.join(d, "nowhere"), path.join(d, "out")]));
    expect(msg).toMatch(/^git clone failed: \S/);
    expect(msg).toContain("nowhere");          // 이유가 무엇을 가리키는지까지 남는다
    expect(msg).not.toMatch(/^Command failed/); // 옛 메시지
    expect(msg).not.toContain("--quiet");       // 명령줄을 되읊지 않는다
    expect(msg).not.toMatch(/fatal:/i);         // 접두어는 떼고 싣는다
    await fs.rm(d, { recursive: true, force: true });
  });

  it("pull: 안내문 꼬리가 아니라 fatal 줄을 고른다", async () => {
    // git pull 의 stderr 는 fatal 뒤에 "Please make sure you have the correct access rights /
    // and the repository exists." 를 더 붙인다. 끝에서 집으면 아무것도 알려주지 못하는 줄이 나온다.
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-git-"));
    await fs.writeFile(path.join(d, "x"), "x");
    await git(["init", "-q", "-b", "main", "."], d);
    await git(["add", "-A"], d);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "v1"], d);
    await git(["remote", "add", "origin", path.join(d, "nowhere")], d);
    const msg = await failure(git(["pull", "--ff-only", "--quiet"], d));
    expect(msg).toMatch(/^git pull failed: \S/);
    expect(msg).not.toMatch(/access rights|repository exists/i);   // 꼬리를 집지 않았다
    expect(msg).not.toMatch(/fatal:/i);
    await fs.rm(d, { recursive: true, force: true });
  });
});
