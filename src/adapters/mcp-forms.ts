import os from "node:os";
import type { Json } from "../core/entries.js";

/**
 * MCP 서버 항목의 도구별 형식 (§7.4 확장). 창고 형식은 Claude Code 의 것이다:
 *   stdio: { type: "stdio", command, args?, env? }     http/sse: { type: "http"|"sse", url, headers? }
 * 시크릿은 "${VAR}" 자리표시자. 각 도구로 갈 때 toLocal, 도구에서 읽을 때 fromLocal 로 바꾼다.
 * 여기 없는 키는 그대로 통과시킨다 — 사용자의 데이터이지 lshed 가 아는 범위가 아니다.
 */
type Obj = { [k: string]: Json };
const isObj = (v: Json | undefined): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const PH = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const HOME_PH = "${HOME}";

/** 값 안의 문자열을 바꾼다 */
function mapStrings(v: Json, f: (s: string) => string): Json {
  if (typeof v === "string") return f(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, f));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapStrings(x, f)]));
  return v;
}

/** type 이 없는 항목에 모양대로 type 을 붙인다 (창고 형식) */
export function canonical(v: Json): Json {
  if (!isObj(v) || typeof v.type === "string") return v;
  if (typeof v.command === "string") return { type: "stdio", ...v };
  if (typeof v.url === "string") return { type: "http", ...v };
  return v;
}

function withoutType(v: Obj): Obj { const { type: _t, ...rest } = v; return rest; }

/* ── Gemini CLI: ~/.gemini/settings.json mcpServers. type 없음, http 는 httpUrl, sse 는 url ── */
export const gemini = {
  toLocal(v: Json): Json {
    if (!isObj(v)) return v;
    const rest = withoutType(v);
    if (v.type === "http" && typeof v.url === "string") { const { url, ...r } = rest; return { httpUrl: url, ...r }; }
    return rest;
  },
  fromLocal(v: Json): Json {
    if (!isObj(v)) return v;
    if (typeof v.httpUrl === "string") { const { httpUrl, ...r } = v; return { type: "http", url: httpUrl, ...r }; }
    if (typeof v.url === "string" && typeof v.command !== "string") return { type: "sse", ...v };
    return canonical(v);
  },
};

/* ── Copilot CLI: ~/.copilot/mcp-config.json mcpServers. type local|http|sse, tools 필수 ── */
export const copilot = {
  toLocal(v: Json): Json {
    if (!isObj(v)) return v;
    const type = v.type === "stdio" || v.type === undefined ? "local" : v.type;
    return { ...v, type, tools: v.tools ?? ["*"] };
  },
  fromLocal(v: Json): Json {
    if (!isObj(v)) return v;
    const out: Obj = { ...v };
    if (out.type === "local") out.type = "stdio";
    if (Array.isArray(out.tools) && out.tools.length === 1 && out.tools[0] === "*") delete out.tools;
    return canonical(out);
  },
};

/* ── Cursor: ~/.cursor/mcp.json mcpServers. type 없음, 자리표시자는 ${env:VAR}, 홈은 ${userHome} ── */
export const cursor = {
  toLocal(v: Json): Json {
    if (!isObj(v)) return v;
    // ${HOME} 만 ${userHome} 으로, 나머지 자리표시자는 ${env:VAR} 로 (HOME 을 먼저 바꾸면 그것까지 env: 가 붙는다)
    return mapStrings(withoutType(v), (s) => s.replace(/\$\{(?!HOME\})([A-Za-z_][A-Za-z0-9_]*)\}/g, "${env:$1}").split(HOME_PH).join("${userHome}"));
  },
  fromLocal(v: Json): Json {
    return canonical(mapStrings(v, (s) => s.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, "${$1}").split("${userHome}").join(HOME_PH)));
  },
};

/* ── Codex: ~/.codex/config.toml [mcp_servers.<id>]. 자리표시자 대신 환경변수 "이름" 을 적는 필드가 있다 ──
 *   env.K = "${K}"                     ↔ env_vars = ["K"]        (이름이 다르면 표현할 수 없어 문자열 그대로 남긴다)
 *   headers.Authorization = "Bearer ${X}" ↔ bearer_token_env_var = "X"
 *   headers.H = "${X}"                 ↔ env_http_headers.H = "X"
 *   그 밖의 헤더                        ↔ http_headers
 *   ${HOME} 은 Codex 가 안 채우므로 실제 홈으로 바꿔 쓴다.
 */
export const codex = {
  toLocal(v: Json, home: string = os.homedir()): Json {
    if (!isObj(v)) return v;
    const out: Obj = withoutType(v);
    if (isObj(out.env)) {
      const env: Obj = {}; const envVars: string[] = Array.isArray(out.env_vars) ? [...(out.env_vars as string[])] : [];
      for (const [k, val] of Object.entries(out.env)) {
        const m = typeof val === "string" ? PH.exec(val) : null;
        if (m && m[1] === k) { if (!envVars.includes(k)) envVars.push(k); } else env[k] = val;
      }
      if (Object.keys(env).length) out.env = env; else delete out.env;
      if (envVars.length) out.env_vars = envVars;
    }
    if (isObj(out.headers)) {
      const http: Obj = isObj(out.http_headers) ? { ...out.http_headers } : {};
      const envHeaders: Obj = isObj(out.env_http_headers) ? { ...out.env_http_headers } : {};
      for (const [h, val] of Object.entries(out.headers)) {
        const bearer = typeof val === "string" && h.toLowerCase() === "authorization" ? /^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(val) : null;
        const m = typeof val === "string" ? PH.exec(val) : null;
        if (bearer) out.bearer_token_env_var = bearer[1];
        else if (m) envHeaders[h] = m[1];
        else http[h] = val;
      }
      delete out.headers;
      if (Object.keys(http).length) out.http_headers = http;
      if (Object.keys(envHeaders).length) out.env_http_headers = envHeaders;
    }
    return mapStrings(out, (s) => s.split(HOME_PH).join(home));
  },
  fromLocal(v: Json): Json {
    if (!isObj(v)) return v;
    const out: Obj = { ...v };
    if (typeof out.command === "string") {
      const env: Obj = isObj(out.env) ? { ...out.env } : {};
      for (const k of Array.isArray(out.env_vars) ? (out.env_vars as string[]) : []) env[k] = `\${${k}}`;
      delete out.env_vars;
      if (Object.keys(env).length) out.env = env; else delete out.env;
    }
    if (typeof out.url === "string") {
      const headers: Obj = isObj(out.http_headers) ? { ...out.http_headers } : {};
      for (const [h, name] of Object.entries(isObj(out.env_http_headers) ? out.env_http_headers : {})) headers[h] = `\${${String(name)}}`;
      if (typeof out.bearer_token_env_var === "string") headers.Authorization = `Bearer \${${out.bearer_token_env_var}}`;
      delete out.http_headers; delete out.env_http_headers; delete out.bearer_token_env_var;
      if (Object.keys(headers).length) out.headers = headers;
    }
    return canonical(out);
  },
};

export const MCP_FORMS = { gemini, copilot, cursor, codex } as const;
export type McpForm = keyof typeof MCP_FORMS;
