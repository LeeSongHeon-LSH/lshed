import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { AgentAdapter } from "../adapters/types.js";

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

/** CLI 를 한 번 돌린다. stdin 은 닫힌 채(codex 는 파이프면 기다린다), 시간이 지나면 죽인다. */
export function ask(cli: string, prompt: string, opts: { cwd: string; timeoutMs: number }): Promise<Answer> {
  const c = askCommand(cli, prompt);
  return new Promise((resolve) => {
    let out = "", err = "", timedOut = false;
    const p = spawn(c.cmd, c.args, { cwd: opts.cwd, env: { ...process.env, ...c.env }, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true });
    const t = setTimeout(() => { timedOut = true; p.kill(); }, opts.timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(t); resolve({ out, err: err + e.message, code: null, timedOut }); });
    p.on("close", (code) => {
      clearTimeout(t);
      if (c.json) { try { const j = JSON.parse(out) as { response?: string }; out = j.response ?? out; } catch { /* 그대로 */ } }
      resolve({ out, err, code, timedOut });
    });
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
    return { agent: adapter.name, skillsDir, passphrase, results };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
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
  return lines.join("\n");
}

export const CHECK_PROMPT = PROMPT;
