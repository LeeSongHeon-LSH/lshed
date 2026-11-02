import os from "node:os";
import type { Ctx } from "./context.js";
import { git, gitRaw, isRepo } from "../git.js";
import { readState } from "../state.js";
import { diff } from "./diff.js";

export interface SyncOptions { message?: string; push?: boolean; dryRun?: boolean }
export interface SyncResult {
  committed: string[];
  pulled: number;
  pushed: boolean;
  /** 로컬 편집이 창고에 반영되지 않은 부품 (save 안내) */
  unsaved: string[];
}

/**
 * 창고 git 래퍼 (§4.4). 창고는 그냥 디렉터리라 동기화는 사용자 몫이지만, 매번 치는 세 명령은 묶어 준다.
 *   1. 창고의 변경을 전부 커밋한다
 *   2. origin 이 있으면 pull --rebase 하고 push 한다
 *   3. 받아온 커밋이 있으면 restore 를 안내한다
 * 충돌이 나면 rebase 를 되돌리고 멈춘다. 창고를 반쯤 꼬인 상태로 두지 않는다.
 */
export async function sync(ctx: Ctx, opts: SyncOptions = {}): Promise<SyncResult> {
  const shed = ctx.shed;
  const push = opts.push ?? true;
  if (!(await isRepo(shed))) {
    throw new Error(`The shed is not a git repository: ${shed}\n  cd ${shed} && git init && git add -A && git commit -m "my harness"\n  To put it on a remote: git remote add origin <url> && git push -u origin HEAD`);
  }
  const res: SyncResult = { committed: [], pulled: 0, pushed: false, unsaved: [] };

  // 0) 로컬 편집이 창고에 안 들어간 채 sync 하면 헛일이다. 알려만 준다.
  if (await readState(ctx.adapter)) {
    try { res.unsaved = (await diff(ctx)).map((d) => `${d.item.category}/${d.item.id}`); } catch { /* 창고가 깨졌으면 아래 git 이 알린다 */ }
    if (res.unsaved.length) ctx.log(`  ! ${res.unsaved.length} local edits are not in the shed: ${res.unsaved.join(", ")}  → lshed save, then sync again`);
  }

  // 1) 커밋
  const dirty = parsePorcelainZ(await gitRaw(["status", "--porcelain", "-z", "--untracked-files=all"], shed));
  if (dirty.length) {
    const msg = opts.message ?? defaultMessage(dirty, (await readState(ctx.adapter))?.profile);
    ctx.log(`  ${opts.dryRun ? "(dry-run) " : ""}commit ${dirty.length}: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` and ${dirty.length - 5} more` : ""}`);
    if (!opts.dryRun) {
      await git(["add", "-A"], shed);
      try {
        await git(["commit", "--quiet", "-m", msg], shed);
      } catch (e) {
        if (/Author identity unknown|Please tell me who you are/.test((e as Error).message)) {
          throw new Error(`Cannot commit without a git identity. Set it once:\n  git config --global user.name "Your Name"\n  git config --global user.email "you@example.com"`);
        }
        throw e;
      }
    }
    res.committed = dirty;
  } else {
    ctx.log("  = nothing to commit in the shed");
  }

  // 2) 원격
  const remote = await git(["remote", "get-url", "origin"], shed).catch(() => null);
  if (!remote) {
    ctx.log("  · no origin, pull/push skipped (git remote add origin <url>)");
    return res;
  }
  if (opts.dryRun) { ctx.log(`  (dry-run) pull --rebase, push → ${remote}`); return res; }

  const before = await git(["rev-parse", "HEAD"], shed);
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], shed);
  const hasUpstream = await git(["rev-parse", "--abbrev-ref", "@{upstream}"], shed).then(() => true, () => false);
  if (hasUpstream) {
    try {
      await git(["pull", "--rebase", "--quiet"], shed);
    } catch (e) {
      await git(["rebase", "--abort"], shed).catch(() => {});
      throw new Error(`pull hit a conflict and was rolled back. Resolve it in the shed:\n  cd ${shed} && git pull --rebase\n  (${firstLine((e as Error).message)})`);
    }
    const after = await git(["rev-parse", "HEAD"], shed);
    if (after !== before) {
      const n = Number(await git(["rev-list", "--count", `${before}..${after}`], shed).catch(() => "0"));
      // rebase 하면 내 커밋도 다시 쓰여 세어지므로, 내 커밋 수를 뺀다
      res.pulled = Math.max(0, n - (res.committed.length ? 1 : 0));
      if (res.pulled) ctx.log(`  ↓ pulled ${res.pulled} commits`);
    }
  } else {
    ctx.log(`  · branch ${branch} has no upstream, pull skipped`);
  }

  // 3) push
  if (push) {
    const ahead = hasUpstream ? Number(await git(["rev-list", "--count", "@{upstream}..HEAD"], shed)) : 1;
    if (ahead > 0) {
      await git(hasUpstream ? ["push", "--quiet"] : ["push", "--quiet", "-u", "origin", branch], shed);
      res.pushed = true;
      ctx.log(`  ↑ push ${hasUpstream ? `${ahead} commits` : `(setting upstream: origin/${branch})`}`);
    } else {
      ctx.log("  = same as remote");
    }
  }

  if (res.pulled) ctx.log(`\nThe shed changed. To apply it on this machine: lshed restore`);
  return res;
}

/**
 * `git status --porcelain -z` 의 경로들. 항목은 `XY path` 이고 NUL 로 끝난다.
 * 출력을 trim 하면 첫 항목의 상태 칸 공백(` M path`)이 사라져 경로 첫 글자가 잘리므로 날것을 받는다.
 * -z 라서 공백·한글 경로도 따옴표나 8진 이스케이프 없이 그대로 온다.
 * 이름 바꾸기·복사(R/C)는 새 경로 다음 항목에 옛 경로가 따로 오므로 건너뛴다.
 */
export function parsePorcelainZ(out: string): string[] {
  const entries = out.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.length < 4) continue;
    paths.push(e.slice(3));
    if (/[RC]/.test(e.slice(0, 2))) i++;
  }
  return paths;
}

function defaultMessage(paths: string[], profile?: string): string {
  const parts = [...new Set(paths.map((p) => p.split("/").slice(0, 2).join("/")))];
  const head = parts.slice(0, 3).join(", ") + (parts.length > 3 ? ` +${parts.length - 3}` : "");
  return `lshed sync: ${head}\n\n${os.hostname()}${profile ? ` · profile ${profile}` : ""}`;
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim() && !l.startsWith("Command failed")) ?? s;
