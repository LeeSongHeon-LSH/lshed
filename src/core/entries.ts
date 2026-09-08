import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EntryCategory } from "../adapters/types.js";

/**
 * 항목형 부품 (§2.3 mcp). 파일이 아니라 설정 파일 안의 JSON 값으로 산다.
 * 창고에는 <category>/<id>.json 으로 두되 시크릿 값은 "${VAR}" 자리표시자로 바꾼다 (§7.1: 키 이름만 휴대).
 *
 *   mask    로컬 값 → 창고 값. 시크릿으로 보이는 키의 값을 자리표시자로.
 *   expand  창고 값 → 로컬 값. 자리표시자를 환경변수로 채운다.
 *   matches 창고 값과 로컬 값이 같은가. 자리표시자는 어떤 문자열과도 맞는다.
 *   remask  로컬 편집을 창고로 되가져올 때, 창고에 있던 자리표시자는 보존한다.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * 값이 시크릿일 법한 키 이름. 확정이 아니라 제안이다. 창고의 json 을 고쳐 조정한다.
 * 부분 문자열이 아니라 단어 단위로 본다: MAX_OUTPUT_TOKENS 나 BYPASS_PERMISSIONS 는 시크릿이 아니다.
 */
const SECRET_WORDS = new Set(["key", "apikey", "token", "secret", "password", "passwd", "auth", "authorization", "credential", "credentials", "cookie", "session"]);
export function isSecretKey(k: string): boolean {
  return k.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).some((w) => SECRET_WORDS.has(w.toLowerCase()));
}

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function placeholdersIn(v: Json): string[] {
  const out = new Set<string>();
  walk(v, (s) => { for (const m of s.matchAll(PLACEHOLDER_RE)) out.add(m[1]); return s; });
  return [...out];
}

function walk(v: Json, onString: (s: string, keyPath: string[]) => string, keyPath: string[] = []): Json {
  if (typeof v === "string") return onString(v, keyPath);
  if (Array.isArray(v)) return v.map((x, i) => walk(x, onString, [...keyPath, String(i)]));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, onString, [...keyPath, k])]));
  return v;
}

/** 환경변수 이름으로 쓸 수 있게 정리: "X-API-Key" → "X_API_KEY" */
const envName = (...parts: string[]) => parts.join("_").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();

/**
 * 시크릿 마스킹. cat.secretKeys(예: env, headers) 바로 아래의 문자열 중 키 이름이 시크릿 같으면 자리표시자로 바꾼다.
 *   env:     { EXA_API_KEY: "sk-.." }           → "${EXA_API_KEY}"          (env 키 이름 그대로)
 *   headers: { Authorization: "Bearer xx" }     → "Bearer ${NOTION_AUTHORIZATION}"  (id_헤더이름; 스킴 단어는 남긴다)
 * 이미 자리표시자면 그대로 둔다.
 */
export type MaskCat = Pick<EntryCategory, "secretKeys" | "secretRootIds">;

export function mask(id: string, entry: Json, cat: MaskCat, home: string = os.homedir()): Json {
  entry = portable(entry, home);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const maskSection = (sect: { [k: string]: Json }, envLike: boolean): { [k: string]: Json } => {
    const masked: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(sect)) {
      if (typeof v !== "string" || !isSecretKey(k) || PLACEHOLDER_RE.test(v)) { masked[k] = v; PLACEHOLDER_RE.lastIndex = 0; continue; }
      const name = envLike ? envName(k) : envName(id, k);
      const scheme = /^(\w+) \S+$/.exec(v);
      masked[k] = scheme ? `${scheme[1]} \${${name}}` : `\${${name}}`;
    }
    return masked;
  };
  if (cat.secretRootIds?.includes(id)) return maskSection(entry, true);
  const out: { [k: string]: Json } = { ...entry };
  for (const sk of cat.secretKeys) {
    const sect = out[sk];
    if (!sect || typeof sect !== "object" || Array.isArray(sect)) continue;
    out[sk] = maskSection(sect, sk === "env");
  }
  return out;
}

/** `C:\Users\me` 나 `C:/Users/me` 처럼 드라이브 문자로 시작하는 Windows 경로인가. 대소문자를 가리지 않고 구분자가 둘 다 온다. */
const isWinPath = (s: string): boolean => /^[A-Za-z]:[\\/]/.test(s);
const slashes = (s: string): string => s.replace(/\\/g, "/");

/**
 * 홈 디렉터리 절대 경로를 ${HOME} 으로. 기기마다 홈이 달라도 훅·명령 경로가 옮겨진다. expand 가 되돌린다.
 * 창고는 OS 를 가리지 않아야 하므로 ${HOME} 뒤는 늘 `/` 다: Windows 기기가 `C:\Users\me\.claude\x` 로도 `C:/Users/me/.claude/x` 로도
 * 써 둔 값이 같은 `${HOME}/.claude/x` 가 되고, Linux 나 WSL 에 복원해도 깨지지 않는다. 홈으로 시작하지 않는 문자열은 손대지 않는다.
 */
export function portable(entry: Json, home: string = os.homedir()): Json {
  if (!home || home === "/") return entry;
  const win = isWinPath(home);
  const norm = (s: string) => (win ? slashes(s).toLowerCase() : s);
  const h = norm(home).replace(/\/+$/, "");
  return walk(entry, (s) => {
    if (s.startsWith("${HOME}")) return "${HOME}" + slashes(s.slice(7));   // 이전 버전이 담은 `${HOME}\...` 도 통일한다
    const n = norm(slashes(s));
    return n === h || n.startsWith(h + "/") ? "${HOME}" + slashes(s.slice(h.length)) : s;
  });
}

/**
 * expand 에 쓸 환경. HOME 은 항상 있다 (Windows 는 USERPROFILE 뿐이라).
 * Windows 에서는 HOME 을 `C:/Users/me` 처럼 `/` 로 준다. 창고의 `${HOME}/...` 뒤가 `/` 라서 결과가 한 종류의 구분자가 되고,
 * 그 형태는 Node, PowerShell, cmd, Git Bash 가 모두 읽는다. `C:\Users\me/.claude/x` 처럼 섞이면 bash 가 `\U` 를 이스케이프로 읽는다.
 */
export function envWithHome(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): NodeJS.ProcessEnv {
  return { ...env, HOME: homeForExpand(env.HOME ?? home) };
}

/** ${HOME} 자리에 넣을 홈: Windows 는 `C:/Users/me` (envWithHome 참고). 창고 값에 홈을 직접 끼우는 어댑터도 이것을 쓴다. */
export function homeForExpand(home: string = os.homedir()): string {
  return isWinPath(home) ? slashes(home) : home;
}

/**
 * ${HOME} 만 채우고 다른 자리표시자는 남긴다. 에이전트가 ${VAR} 를 스스로 확장하더라도 HOME 은 lshed 가 채운다:
 * ${HOME} 은 portable() 이 만든 lshed 의 표기이고, Windows 에는 HOME 변수가 없어 에이전트가 채울 수 없다
 * (Claude Code 2.1.265 는 HOME 이 없으면 "Missing environment variables: HOME" 을 내고 서버를 띄우지 않는다 — 실측).
 */
export function expandHome(entry: Json, home: string = os.homedir()): Json {
  const h = homeForExpand(home);
  return walk(entry, (s) => s.split("${HOME}").join(h));
}

/** 값 안에서 시크릿처럼 생긴 문자열 (args, url 등 마스킹 대상이 아닌 곳). init 이 경고만 한다. */
export function suspiciousStrings(entry: Json): string[] {
  const out: string[] = [];
  walk(entry, (s, kp) => { if (/^(sk-|ghp_|github_pat_|xox[abp]-|AKIA|glpat-|ntn_|secret_)[A-Za-z0-9_-]{8,}/.test(s)) out.push(kp.join(".")); return s; });
  return out;
}

export interface Expanded { value: Json; missing: string[] }

/** 자리표시자를 환경변수로 채운다. 없으면 missing 에 모으고 그 자리는 그대로 둔다. */
export function expand(entry: Json, env: NodeJS.ProcessEnv = process.env): Expanded {
  const missing = new Set<string>();
  const value = walk(entry, (s) =>
    s.replace(PLACEHOLDER_RE, (whole, name: string, def?: string) => {
      if (env[name] !== undefined) return env[name]!;
      if (def !== undefined) return def;
      missing.add(name);
      return whole;
    }),
  );
  return { value, missing: [...missing] };
}

/**
 * 자리표시자가 든 창고 문자열이 로컬 문자열과 맞는가. 자리표시자는 와일드카드.
 * ${HOME} 으로 시작하는 창고 문자열은 `/` 로 담기므로, 로컬이 `C:\Users\me\.claude\x` 처럼 Windows 식이어도 구분자와 대소문자를 무시하고
 * 견준다 — 사용자가 직접 써 둔 값이 영구 드리프트로 잡히면 안 된다.
 */
function stringMatches(shed: string, local: string): boolean {
  if (shed === local) return true;
  if (shed.startsWith("${HOME}") && isWinPath(local)) { shed = shed.toLowerCase(); local = slashes(local).toLowerCase(); }
  if (!PLACEHOLDER_RE.test(shed)) { PLACEHOLDER_RE.lastIndex = 0; return false; }
  PLACEHOLDER_RE.lastIndex = 0;
  const re = "^" + shed.split(PLACEHOLDER_RE).map((part, i) => (i % 3 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : i % 3 === 1 ? ".+" : "")).join("") + "$";
  return new RegExp(re).test(local);
}

/** 구조 비교. 창고 쪽 자리표시자는 로컬의 어떤 값과도 맞는다. */
export function matches(shed: Json, local: Json): boolean {
  if (typeof shed === "string" && typeof local === "string") return stringMatches(shed, local);
  if (Array.isArray(shed) && Array.isArray(local)) return shed.length === local.length && shed.every((x, i) => matches(x, local[i]));
  if (shed && local && typeof shed === "object" && typeof local === "object" && !Array.isArray(shed) && !Array.isArray(local)) {
    const a = Object.keys(shed).sort(), b = Object.keys(local).sort();
    return a.length === b.length && a.every((k, i) => k === b[i] && matches(shed[k], local[k]));
  }
  return shed === local;
}

/** 로컬 값을 창고로 되가져온다. 창고에 있던 자리표시자가 여전히 맞으면 보존하고, 새 시크릿 키는 마스킹한다. */
export function remask(id: string, local: Json, shed: Json | null, cat: MaskCat, home: string = os.homedir()): Json {
  const keep = (l: Json, s: Json | undefined): Json => {
    if (typeof l === "string" && typeof s === "string" && stringMatches(s, l)) return s;
    if (Array.isArray(l) && Array.isArray(s)) return l.map((x, i) => keep(x, s[i]));
    if (l && s && typeof l === "object" && typeof s === "object" && !Array.isArray(l) && !Array.isArray(s)) {
      return Object.fromEntries(Object.entries(l).map(([k, x]) => [k, keep(x, s[k])]));
    }
    return l;
  };
  return mask(id, shed === null ? local : keep(local, portable(shed, home)), cat, home);
}

/** 다른 키 경로 목록 (diff 표시용). 창고에만 있으면 D, 로컬에만 있으면 A, 다르면 M. */
export function diffEntry(shed: Json, local: Json | undefined): { status: "A" | "M" | "D"; file: string }[] {
  const out: { status: "A" | "M" | "D"; file: string }[] = [];
  const go = (s: Json | undefined, l: Json | undefined, kp: string) => {
    if (s === undefined) { out.push({ status: "A", file: kp || "(entry)" }); return; }
    if (l === undefined) { out.push({ status: "D", file: kp || "(entry)" }); return; }
    const objs = s && l && typeof s === "object" && typeof l === "object" && !Array.isArray(s) && !Array.isArray(l);
    if (objs) {
      for (const k of new Set([...Object.keys(s), ...Object.keys(l)]).values()) go((s as { [k: string]: Json })[k], (l as { [k: string]: Json })[k], kp ? `${kp}.${k}` : k);
      return;
    }
    if (!matches(s, l)) out.push({ status: "M", file: kp || "(entry)" });
  };
  go(shed, local, "");
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export async function readEntryFile(p: string): Promise<Json | null> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as Json; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${p}: cannot parse JSON: ${(e as Error).message}`);
  }
}

export async function writeEntryFile(p: string, v: Json): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(v, null, 2) + "\n");
}
