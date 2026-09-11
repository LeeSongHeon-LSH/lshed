import os from "node:os";
import { execFile, spawn } from "node:child_process";
import type { AgentAdapter } from "../adapters/types.js";
import { readState } from "../state.js";
import { loadManifest, type Ctx } from "./context.js";
import { invocation } from "../shell.js";

export const ISSUES_URL = "https://github.com/LeeSongHeon-LSH/lshed/issues";

/** 에이전트별 CLI: 버전만 묻는다. `agents` 는 공용 폴더라 특정 CLI 가 없다. */
const CLI_OF: Record<string, string | undefined> = {
  "claude-code": "claude", codex: "codex", gemini: "gemini", copilot: "copilot", cursor: "agent", agy: "agy",
};

/**
 * 사용자가 이슈에 붙여 넣는 요약. 값은 담지 않는다: 환경변수 값도, 설정 내용도, 창고 파일도.
 * 담는 것은 버전, OS, 어떤 에이전트의 어느 루트인지, 적용 프로필의 수치, 창고에 든 것의 이름과 개수, 실패한 명령과 메시지.
 * 홈 경로는 `~` 로 바꾼다 (사용자 이름이 이슈에 남지 않게).
 */
export interface Report {
  lshed: string;
  runtime: string;
  os: string;
  agent: string;
  root: string;
  /** `<cli> <version>` 또는 `<cli>: not found`. CLI 가 없는 에이전트(agents)는 생략. */
  tool?: string;
  state: { profile: string; managed: number; appliedAt: string; placement: "links" | "copies"; failedInstalls?: string[] } | null | `unreadable: ${string}`;
  shed?: { path: string; components: Record<string, string[]>; packages: string[]; profiles: string[] } | `unreadable: ${string}`;
  command?: string;
  error?: string;
}

export interface CollectOpts {
  version: string;
  adapter: AgentAdapter;
  /** 알면 창고 위치 (--shed, LSHED_HOME, state). 모르면 창고 절이 빠진다. */
  shed?: string;
  command?: string;
  error?: string;
  /** 테스트용: 홈 디렉터리와 CLI 버전 조회를 바꿔 끼운다. */
  home?: string;
  platform?: NodeJS.Platform;
  toolVersion?: (bin: string) => Promise<string | undefined>;
}

/**
 * 홈 디렉터리를 `~` 로. Windows 는 `\` 와 `/` 어느 쪽으로 쓰였든, 대소문자가 달라도 잡는다.
 * Windows 는 같은 폴더가 8.3 짧은 이름으로도 나타난다(`C:\Users\RUNNER~1` = `C:\Users\runneradmin`; TEMP 가 흔히 그렇다).
 * 긴 이름만 보면 그런 경로가 사용자 이름째 남으므로, 홈이 `<드라이브>:\Users\<이름>` 꼴이면 그 드라이브의 `\Users\<무엇이든>` 을 전부 `~` 로 본다 —
 * 다른 사용자의 폴더까지 가려지지만, 보고서에서는 덜 남기는 쪽이 맞다.
 */
export function redact(text: string, home = os.homedir(), platform: NodeJS.Platform = process.platform): string {
  if (!home || home.length < 3) return text;   // "/" 나 "C:" 같은 홈은 모든 경로에 걸린다 — 그럴 때는 그대로 둔다
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const win = platform === "win32";
  const patterns: string[] = [];
  const users = win ? /^([A-Za-z]:)[\\/]Users[\\/][^\\/]+$/.exec(home) : null;
  if (users) patterns.push(`${esc(users[1])}[\\\\/]Users[\\\\/][^\\\\/]+`);
  else for (const h of new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")])) patterns.push(esc(h));
  let out = text;
  for (const p of patterns) out = out.replace(new RegExp(p, win ? "gi" : "g"), "~");
  return out;
}

/** `<bin> --version` 의 첫 줄. 5초 안에 답이 없거나 실행파일이 없으면 undefined. 실패 원인은 보고서에 넣지 않는다. */
export function toolVersion(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const iv = invocation(bin, ["--version"]);
    execFile(iv.file, iv.args, { timeout: 5000, shell: iv.shell, windowsHide: true }, (err, stdout) => {
      const line = String(stdout ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(err && !line ? undefined : line);
    });
  });
}

export async function collectReport(o: CollectOpts): Promise<Report> {
  const home = o.home ?? os.homedir();
  const r = (s: string) => redact(s, home, o.platform);
  const report: Report = {
    lshed: o.version,
    runtime: process.versions.bun ? `bun ${process.versions.bun} (standalone binary)` : `node ${process.version}`,
    os: `${process.platform} ${os.release()} ${process.arch}`,
    agent: o.adapter.name,
    root: r(o.adapter.root),
    state: null,
  };
  const cli = CLI_OF[o.adapter.name];
  if (cli) {
    const v = await (o.toolVersion ?? toolVersion)(cli);
    report.tool = v ? `${cli} ${v}` : `${cli}: not found`;
  }
  try {
    const s = await readState(o.adapter);
    if (s) report.state = { profile: s.profile, managed: s.managed.length, appliedAt: s.appliedAt, placement: s.link ? "links" : "copies", ...(s.failedInstalls?.length ? { failedInstalls: s.failedInstalls } : {}) };
  } catch (e) {
    report.state = `unreadable: ${r((e as Error).message)}`;
  }
  if (o.shed) {
    try {
      const ctx: Ctx = { adapter: o.adapter, shed: o.shed, log: () => {}, exec: async () => {} };
      const m = await loadManifest(ctx);
      const components: Record<string, string[]> = {};
      for (const [cat, comps] of Object.entries(m.components)) if (comps.length) components[cat] = comps.map((c) => c.id);
      report.shed = { path: r(o.shed), components, packages: m.packages.map((p) => p.id), profiles: Object.keys(m.profiles) };
    } catch (e) {
      report.shed = `unreadable: ${r((e as Error).message)}`;
    }
  }
  if (o.command) report.command = r(o.command);
  if (o.error) report.error = r(o.error);
  return report;
}

/** 이슈에 붙여 넣는 형태. status 처럼 `이름  값` 줄이고, 창고 내용은 들여쓴 줄에 카테고리별로. */
export function formatReport(r: Report): string {
  const row = (label: string, text: string) => `${label.padEnd(9)}  ${text}`;
  const lines = [
    row("lshed", `${r.lshed} (${r.runtime})`),
    row("os", r.os),
    row("agent", `${r.agent} (${r.root})`),
  ];
  if (r.tool) lines.push(row("tool", r.tool));
  if (r.state === null) lines.push(row("profile", "none applied"));
  else if (typeof r.state === "string") lines.push(row("profile", r.state));
  else lines.push(row("profile", `${r.state.profile}, ${r.state.managed} managed paths, ${r.state.placement}, applied ${r.state.appliedAt}${r.state.failedInstalls?.length ? `, install failed: ${r.state.failedInstalls.join(", ")}` : ""}`));
  if (r.shed === undefined) lines.push(row("shed", "unknown"));
  else if (typeof r.shed === "string") lines.push(row("shed", r.shed));
  else {
    lines.push(row("shed", r.shed.path));
    for (const [cat, ids] of Object.entries(r.shed.components)) lines.push(`${" ".repeat(11)}${cat.padEnd(13)} ${ids.length}: ${ids.join(", ")}`);
    lines.push(`${" ".repeat(11)}${"packages".padEnd(13)} ${r.shed.packages.length ? `${r.shed.packages.length}: ${r.shed.packages.join(", ")}` : "none"}`);
    lines.push(`${" ".repeat(11)}${"profiles".padEnd(13)} ${r.shed.profiles.join(", ") || "none"}`);
  }
  if (r.command) lines.push(row("command", r.command));
  if (r.error) lines.push(row("error", r.error));
  return lines.join("\n");
}

/** 이슈 폼(.github/ISSUE_TEMPLATE/bug.yml)의 `report` 칸을 미리 채운 URL. 너무 길면 칸을 비우고 붙여 넣게 한다. */
export function issueUrl(r: Report, kind: "bug" | "verified" = "bug"): string {
  const base = `${ISSUES_URL}/new?template=${kind}.yml`;
  const title = kind === "bug" && r.error ? `&title=${encodeURIComponent(r.error.split("\n")[0].slice(0, 80))}` : "";
  const full = `${base}${title}&report=${encodeURIComponent(formatReport(r))}`;
  return full.length <= 7000 ? full : `${base}${title}`;
}

/**
 * 브라우저를 여는 명령. OS 마다 다르고 함정도 다르다:
 *  - Windows: `cmd /c start` 는 URL 의 `&` 에서 명령을 끊고 `%xx%` 를 변수로 펼친다. PowerShell 에 base64 로 인코딩한 명령을 주면 아무것도 해석되지 않는다.
 *  - macOS: `open`.
 *  - 그 외(Linux, BSD): `xdg-open`. WSL 에는 보통 없고 `wslview`(wslu) 가 있으므로 그것도 후보에 둔다.
 * 순서대로 시도하고, 첫 번째로 실행이 되는 것에서 멈춘다. 열렸는지는 알 수 없으므로 URL 은 호출한 쪽이 따로 찍는다.
 */
export function openCommands(url: string, platform: NodeJS.Platform = process.platform): { cmd: string; args: string[] }[] {
  if (platform === "win32") {
    const ps = `Start-Process -FilePath '${url.replace(/'/g, "''")}'`;
    const encoded = Buffer.from(ps, "utf16le").toString("base64");
    return [{ cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded] }];
  }
  if (platform === "darwin") return [{ cmd: "open", args: [url] }];
  return [{ cmd: "xdg-open", args: [url] }, { cmd: "wslview", args: [url] }];
}

export function openUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  const candidates = openCommands(url, platform);
  const tryNext = (i: number): void => {
    const c = candidates[i];
    if (!c) return;   // 열 수 없으면 URL 만 남는다
    try {
      const p = spawn(c.cmd, c.args, { stdio: "ignore", detached: platform !== "win32", windowsHide: true });
      p.on("error", () => tryNext(i + 1));
      p.unref();
    } catch { tryNext(i + 1); }
  };
  tryNext(0);
}
