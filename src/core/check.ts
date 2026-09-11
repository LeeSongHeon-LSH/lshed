import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentAdapter } from "../adapters/types.js";
import { invocation } from "../shell.js";

/**
 * 조용한 실패를 소리 나게 하는 검사. lshed 가 성공했다고 해도 에이전트가 그 파일을 읽는지는 다른 문제다 —
 * 스킬 하나(임의 암호어)를 에이전트의 스킬 폴더에 놓고, 그 에이전트의 CLI 에 비대화형으로 암호어를 물은 뒤 치운다.
 * 암호어가 돌아오면 배치 위치·형식이 맞다는 뜻이고, 안 돌아오면 그 답을 그대로 보여 주고 report 를 권한다.
 * scripts/vm/probe.sh 의 스킬 질문 하나를 사용자용으로 옮긴 것이다. 플래그는 거기서 실측된 것과 같다.
 */

const SKILL_ID = "lshed-check";
const PROMPT = `$${SKILL_ID} Use the ${SKILL_ID} skill: open its SKILL.md and reply with only the lshed check passphrase written in it.`;

/** 에이전트 → 물어볼 CLI. `agents` 는 공용 폴더라 설치된 것 전부에 묻는다. */
export function askersOf(agent: string): string[] {
  switch (agent) {
    case "claude-code": return ["claude"];
    case "codex": return ["codex"];
    case "gemini": return ["gemini"];
    case "copilot": return ["copilot"];
    case "cursor": return ["agent"];
    case "agy": return ["agy"];
    case "agents": return ["codex", "gemini", "copilot", "agent"];
    default: return [];
  }
}

/** 각 CLI 의 비대화형 호출. probe.sh 와 같다. gemini 는 JSON 으로 받아 response 만 본다. */
export function askCommand(cli: string, prompt: string): { cmd: string; args: string[]; env?: Record<string, string>; json?: boolean } {
  switch (cli) {
    case "claude": return { cmd: "claude", args: ["-p", prompt] };
    case "codex": return { cmd: "codex", args: ["exec", "--skip-git-repo-check", "--ephemeral", prompt] };
    case "gemini": return { cmd: "gemini", args: ["-p", prompt, "--approval-mode", "yolo", "--output-format", "json"], env: { GEMINI_CLI_TRUST_WORKSPACE: "true" }, json: true };
    case "copilot": return { cmd: "copilot", args: ["-p", prompt, "-s", "--allow-all-tools"] };
    case "agent": return { cmd: "agent", args: ["-p", prompt, "--output-format", "text"] };
    case "agy": return { cmd: "agy", args: ["-p", prompt, "--output-format", "text", "--dangerously-skip-permissions"] };
    default: throw new Error(`no way to ask ${cli}`);
  }
}

/** PATH 에 실행파일이 있는가. Windows 는 PATHEXT 의 확장자(.cmd, .exe, …)를 붙여 본다. */
export async function installed(cli: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  const exts = platform === "win32" ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()) : [""];
  for (const d of dirs) for (const e of exts) {
    try { await fs.access(path.join(d, cli + e)); return true; } catch { /* next */ }
  }
  return false;
}

export interface Answer { out: string; err: string; code: number | null; timedOut: boolean }

/**
 * 죽은 자식이 남긴 파이프를 언제까지 기다릴지. 'exit' 뒤 남은 출력은 곧바로 흘러나오므로 넉넉한 값이다.
 * 이 유예가 없으면 손자가 파이프를 쥔 채 살아남았을 때 'close' 가 영영 오지 않는다.
 */
const PIPE_GRACE_MS = 2_000;

/**
 * 프로세스를 트리째 죽인다. win32 의 kill() 은 TerminateProcess 라 대상 하나만 끝낸다 —
 * `cmd.exe /c claude.cmd …` 에서 죽는 것은 cmd.exe 뿐이고, 그 아래 node 는 살아서 우리 파이프를 쥐고 있다.
 */
function killTree(p: ReturnType<typeof spawn>): void {
  if (process.platform === "win32" && p.pid !== undefined) {
    // taskkill 이 없거나 이미 끝난 프로세스면 실패한다. 어느 쪽이든 아래 kill() 로 최소한 셸은 끝낸다.
    spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => { /* 아래 kill() */ });
  }
  p.kill();
}

/**
 * CLI 를 한 번 돌린다. stdin 은 닫힌 채(codex 는 파이프면 기다린다), 시간이 지나면 죽인다.
 *
 * 이 함수는 어떤 경우에도 반드시 답을 돌려준다. 예전에는 'close' 에서만 끝냈는데, 'close' 는 파이프가 모두
 * 닫혀야 오므로 (a) 죽인 프로세스의 자식이 그 파이프를 물려받아 살아 있거나 (b) CLI 가 종료 신호를 무시하면
 * 영영 오지 않았다. Windows 의 kill() 은 cmd.exe 하나만 끝내므로 (a) 가 늘 걸릴 수 있는 자리였다.
 * 그러면 lshed check 가 --timeout 을 지나도 멈춰 있고, check() 의 정리(finally)가 돌지 않아
 * skills/lshed-check 가 남아 그다음 실행까지 "already exists" 로 막았다.
 */
export function ask(cli: string, prompt: string, opts: { cwd: string; timeoutMs: number; graceMs?: number }): Promise<Answer> {
  const c = askCommand(cli, prompt);
  const graceMs = opts.graceMs ?? PIPE_GRACE_MS;
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false, settled = false, exited = false;
    let grace: NodeJS.Timeout | undefined;
    const so = { cwd: opts.cwd, env: { ...process.env, ...c.env }, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], windowsHide: true };
    // Windows 의 .cmd 래퍼는 셸이 필요하다. args 와 shell 을 함께 주면 Node 24 가 DEP0190 을 찍으므로 한 줄로 만든다.
    const iv = invocation(c.cmd, c.args);
    const p = spawn(iv.file, iv.args, { ...so, shell: iv.shell });

    const finish = (code: number | null, extraErr = ""): void => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      if (grace) clearTimeout(grace);
      if (c.json) { try { const j = JSON.parse(out) as { response?: string }; out = j.response ?? out; } catch { /* 그대로 */ } }
      resolve({ out, err: err + extraErr, code, timedOut });
    };
    /** 유예 시간까지만 'close' 를 기다리고, 오지 않으면 남은 것을 끊고 끝낸다 */
    const settleSoon = (code: number | null): void => {
      if (settled || grace) return;
      grace = setTimeout(() => {
        if (!exited) p.kill("SIGKILL");   // 앞선 kill 을 무시한 프로세스의 마지막 수단. 이미 끝났으면 보내지 않는다 (그 PID 는 남의 것일 수 있다)
        p.stdout.destroy(); p.stderr.destroy(); p.unref();   // 손자가 쥔 파이프를 놓아 준다 (안 그러면 lshed 가 못 끝난다)
        finish(code);
      }, graceMs);
    };

    const t = setTimeout(() => { timedOut = true; killTree(p); settleSoon(null); }, opts.timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => finish(null, e.message));
    p.on("exit", (code) => { exited = true; settleSoon(code); });
    p.on("close", (code) => finish(code));
  });
}

export interface CliResult {
  cli: string;
  status: "read" | "not-read" | "not-installed";
  attempts: Answer[];
}
export interface CheckResult {
  agent: string;
  skillsDir: string;
  passphrase: string;
  results: CliResult[];
  /**
   * 지우려다 남긴 것. Windows 에서는 죽은 CLI 의 자식이 작업 폴더를 쥔 채 살아 있을 수 있어 rmdir 가 EBUSY 로 막힌다
   * (6차 검증). 정리 실패는 검사 결과를 덮지 않고 여기 담겨 한 줄로 알려진다.
   */
  leftovers: string[];
}

export interface CheckOpts {
  attempts?: number;
  timeoutMs?: number;
  /** 테스트용 주입 */
  ask?: typeof ask;
  installed?: (cli: string) => Promise<boolean>;
  passphrase?: string;
}

/** 어댑터의 스킬 폴더 (절대 경로). 스킬 카테고리가 없는 어댑터는 없다. */
export function skillsDirOf(adapter: AgentAdapter): string {
  const cat = adapter.categories().find((c) => c.name === "skills");
  if (!cat) throw new Error(`${adapter.name} has no skills category`);
  return path.join(adapter.root, ...cat.root.split("/"));
}

export async function check(adapter: AgentAdapter, opts: CheckOpts = {}): Promise<CheckResult> {
  const attempts = opts.attempts ?? 2, timeoutMs = opts.timeoutMs ?? 120_000;
  const doAsk = opts.ask ?? ask, isInstalled = opts.installed ?? installed;
  const passphrase = opts.passphrase ?? `check-${randomBytes(5).toString("hex")}`;
  const skillsDir = skillsDirOf(adapter);
  const dir = path.join(skillsDir, SKILL_ID);
  // 사용자 것을 덮지 않는다. 지난 검사가 치우지 못한 것이라도 사용자가 보고 지우게 한다.
  if (await fs.stat(dir).then(() => true, () => false)) throw new Error(`${dir} already exists. Remove it and run the check again.`);
  await fs.mkdir(dir, { recursive: true });
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "lshed-check-"));   // 프로젝트 설정이 끼어들지 않는 빈 작업 폴더
  const leftovers: string[] = [];
  try {
    await fs.writeFile(path.join(dir, "SKILL.md"), [
      "---", `name: ${SKILL_ID}`, "description: Use when asked for the lshed check passphrase. Answers lshed's placement check.", "---",
      "When asked for the lshed check passphrase, reply with exactly this word and nothing else:", "", passphrase, "",
    ].join("\n"));
    const results: CliResult[] = [];
    for (const cli of askersOf(adapter.name)) {
      if (!(await isInstalled(cli))) { results.push({ cli, status: "not-installed", attempts: [] }); continue; }
      const tries: Answer[] = [];
      let read = false;
      for (let i = 0; i < attempts && !read; i++) {
        const a = await doAsk(cli, PROMPT, { cwd, timeoutMs });
        tries.push(a);
        read = a.out.includes(passphrase);
      }
      results.push({ cli, status: read ? "read" : "not-read", attempts: tries });
    }
    return { agent: adapter.name, skillsDir, passphrase, results, leftovers };
  } finally {
    // 정리는 검사 결과를 덮지 않는다 — 사용자가 보러 온 것은 그 결과다. 예전에는 여기서 던지면
    // (timed out) 도 답 발췌도 사라지고 EBUSY 메시지만 남았다. 잠금은 대개 곧 풀리므로 몇 번 다시 해 보고,
    // 그래도 남으면 무엇이 남았는지 알린다. 임시 폴더가 먼저 막혀도 스킬 폴더는 반드시 치운다 (그것이 다음 검사를 막는다).
    for (const p of [dir, cwd]) {
      try { await fs.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      catch { leftovers.push(p); }
    }
  }
}

const excerpt = (s: string, n = 160) => s.replace(/\s+/g, " ").trim().slice(0, n);
/** stderr 는 배너가 앞에, 오류가 뒤에 온다 — 끝을 보여 준다. */
const tail = (s: string, n = 200) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `…${t.slice(-n)}` : t; };

/** 사람이 읽는 결과. status 의 틀을 따른다: 한 줄 요약, 문제만 들여쓴 상세. */
export function formatCheck(r: CheckResult, homeAs = (s: string) => s): string {
  const lines = [`check      ${r.agent}: skill placed in ${homeAs(r.skillsDir)}, asked for its passphrase, removed`];
  for (const c of r.results) {
    if (c.status === "not-installed") { lines.push(`  · ${c.cli}: not installed here, nothing to ask`); continue; }
    if (c.status === "read") { lines.push(`  ✔ ${c.cli} read the skill  (attempt ${c.attempts.length})`); continue; }
    lines.push(`  ✘ ${c.cli} did not answer with the passphrase in ${c.attempts.length} ${c.attempts.length === 1 ? "attempt" : "attempts"}`);
    c.attempts.forEach((a, i) => {
      lines.push(`      attempt ${i + 1}: ${a.timedOut ? "(timed out) " : a.code ? `(exit ${a.code}) ` : ""}${excerpt(a.out) || "(no output)"}`);
      if (a.err.trim()) lines.push(`        stderr: ${tail(a.err)}`);
    });
    lines.push(`    If lshed placed the file where ${c.cli} should read it, this is worth reporting: lshed report`);
  }
  // 남긴 것이 있으면 마지막에 말한다. 스킬 폴더가 남았다면 다음 검사가 거부되므로 그 사실까지 적는다.
  for (const p of r.leftovers) {
    const blocks = p.endsWith(SKILL_ID) ? " The next check will refuse to start until it is gone." : "";
    lines.push(`  ! could not remove ${homeAs(p)} — something still has it open.${blocks} Remove it yourself.`);
  }
  return lines.join("\n");
}

export const CHECK_PROMPT = PROMPT;
