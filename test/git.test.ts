import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { git } from "../src/git.js";

// 사용자가 보는 것은 이 줄이다. 0.17.3 까지는 "Command failed: git clone --quiet -- <url> <dir>" 만 나와서
// 왜 실패했는지(없는 저장소인지, 권한인지, 네트워크인지)를 알 수 없었다.
describe("git 오류 메시지", () => {
  it("clone: 실패한 이유를 싣는다", async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-git-"));
    await expect(git(["clone", "--quiet", "--", path.join(d, "nowhere"), path.join(d, "out")]))
      .rejects.toThrow(/^git clone failed: repository .* does not exist$/);
    await fs.rm(d, { recursive: true, force: true });
  });

  it("pull: 안내문 꼬리가 아니라 fatal 줄을 고른다", async () => {
    // git pull 의 stderr 는 fatal 뒤에 "Please make sure …/and the repository exists." 를 더 붙인다
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-git-"));
    await fs.writeFile(path.join(d, "x"), "x");
    await git(["init", "-q", "-b", "main", "."], d);
    await git(["add", "-A"], d);
    await git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "v1"], d);
    await git(["remote", "add", "origin", path.join(d, "nowhere")], d);
    await expect(git(["pull", "--ff-only", "--quiet"], d)).rejects.toThrow(/^git pull failed: .*does not appear to be a git repository$/);
    await fs.rm(d, { recursive: true, force: true });
  });
});
