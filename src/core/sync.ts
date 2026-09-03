import os from "node:os";
import type { Ctx } from "./context.js";
import { git, isRepo } from "../git.js";
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
    throw new Error(`창고가 git 저장소가 아닙니다: ${shed}\n  cd ${shed} && git init && git add -A && git commit -m "my harness"\n  원격에 두려면: git remote add origin <url> && git push -u origin HEAD`);
  }
  const res: SyncResult = { committed: [], pulled: 0, pushed: false, unsaved: [] };

  // 0) 로컬 편집이 창고에 안 들어간 채 sync 하면 헛일이다. 알려만 준다.
  if (await readState(ctx.adapter)) {
    try { res.unsaved = (await diff(ctx)).map((d) => `${d.item.category}/${d.item.id}`); } catch { /* 창고가 깨졌으면 아래 git 이 알린다 */ }
    if (res.unsaved.length) ctx.log(`  ! 로컬 편집 ${res.unsaved.length}개가 창고에 없습니다: ${res.unsaved.join(", ")}  → lshed save 후 다시 sync`);
  }

  // 1) 커밋
  const dirty = (await git(["status", "--porcelain", "--untracked-files=all"], shed)).split("\n").filter(Boolean).map((l) => l.slice(3).trim());
  if (dirty.length) {
    const msg = opts.message ?? defaultMessage(dirty, (await readState(ctx.adapter))?.profile);
    ctx.log(`  ${opts.dryRun ? "(dry-run) " : ""}commit ${dirty.length}개: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` 외 ${dirty.length - 5}` : ""}`);
    if (!opts.dryRun) {
      await git(["add", "-A"], shed);
      await git(["commit", "--quiet", "-m", msg], shed);
    }
    res.committed = dirty;
  } else {
    ctx.log("  = 창고에 커밋할 변경 없음");
  }

  // 2) 원격
  const remote = await git(["remote", "get-url", "origin"], shed).catch(() => null);
  if (!remote) {
    ctx.log("  · origin 이 없어 pull/push 는 건너뜀 (git remote add origin <url>)");
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
      throw new Error(`pull 중 충돌이 나서 되돌렸습니다. 창고에서 직접 해결하세요:\n  cd ${shed} && git pull --rebase\n  (${firstLine((e as Error).message)})`);
    }
    const after = await git(["rev-parse", "HEAD"], shed);
    if (after !== before) {
      const n = Number(await git(["rev-list", "--count", `${before}..${after}`], shed).catch(() => "0"));
      // rebase 하면 내 커밋도 다시 쓰여 세어지므로, 내 커밋 수를 뺀다
      res.pulled = Math.max(0, n - (res.committed.length ? 1 : 0));
      if (res.pulled) ctx.log(`  ↓ 원격 커밋 ${res.pulled}개 받음`);
    }
  } else {
    ctx.log(`  · 브랜치 ${branch} 에 upstream 이 없어 pull 은 건너뜀`);
  }

  // 3) push
  if (push) {
    const ahead = hasUpstream ? Number(await git(["rev-list", "--count", "@{upstream}..HEAD"], shed)) : 1;
    if (ahead > 0) {
      await git(hasUpstream ? ["push", "--quiet"] : ["push", "--quiet", "-u", "origin", branch], shed);
      res.pushed = true;
      ctx.log(`  ↑ push ${hasUpstream ? `${ahead}개 커밋` : `(upstream 설정: origin/${branch})`}`);
    } else {
      ctx.log("  = 원격과 같음");
    }
  }

  if (res.pulled) ctx.log(`\n창고가 바뀌었습니다. 이 기기에 적용하려면: lshed restore`);
  return res;
}

function defaultMessage(paths: string[], profile?: string): string {
  const parts = [...new Set(paths.map((p) => p.split("/").slice(0, 2).join("/")))];
  const head = parts.slice(0, 3).join(", ") + (parts.length > 3 ? ` +${parts.length - 3}` : "");
  return `lshed sync: ${head}\n\n${os.hostname()}${profile ? ` · profile ${profile}` : ""}`;
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim() && !l.startsWith("Command failed")) ?? s;
