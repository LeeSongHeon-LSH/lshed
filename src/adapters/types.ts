/** 에이전트 어댑터 경계 (§4.6). 카테고리·경로·지침 전략은 전부 여기서 나온다. */
export interface Category {
  name: string;
  /** 어댑터 루트 기준 상대 경로 */
  root: string;
  /** dir: <root>/<id>/ 디렉터리, file: <root>/<id>.md 파일 */
  kind: "dir" | "file";
}

/**
 * 파일이 아니라 설정 파일 안의 JSON 항목으로 사는 카테고리 (예: MCP 서버, §2.3).
 * 창고에는 <name>/<id>.json 으로 담기며 시크릿은 "${VAR}" 자리표시자로 바뀐다 (§7.1).
 */
export interface EntryCategory {
  name: string;
  kind: "entry";
  /** 이 키들 바로 아래의 시크릿 같은 값을 마스킹한다 (예: env, headers) */
  secretKeys: readonly string[];
  /** 항목 자체가 시크릿 맵인 id (예: settings 의 env) */
  secretRootIds?: readonly string[];
  /** 에이전트가 "${VAR}" 를 스스로 확장하는가. true 면 자리표시자를 그대로 배치하고 시크릿은 lshed 를 거치지 않는다 */
  expandsEnv: boolean;
  /** 로컬의 모든 항목 (id → 값) */
  read(): Promise<Record<string, unknown>>;
  /** 항목 하나를 쓰거나(value) 지운다(null). 설정 파일의 다른 키는 건드리지 않는다 */
  write(id: string, value: unknown | null): Promise<void>;
}

export interface ScannedComponent {
  category: string;
  id: string;
  /** 절대 경로 */
  path: string;
}

import type { Installer } from "../installers/types.js";

export interface AgentAdapter {
  /** 이 에이전트 고유의 패키지 설치기 (플러그인 등). 없으면 빈 배열 */
  installers(): readonly Installer[];
  readonly name: string;
  /** 사용자 레벨 설정 루트 (예: ~/.claude). 테스트에서 주입 가능. */
  readonly root: string;
  categories(): readonly Category[];
  /** 항목형 카테고리 (MCP 등). 없으면 빈 배열 */
  entries(): readonly EntryCategory[];
  /** 지침 파일: import 목록 생성 vs 단순 연결 (§3.3) */
  instructionsStrategy(): "import" | "concat";
  /** 지침 파일 이름 (루트 기준). 예: CLAUDE.md. 사용자 수준 지침 파일이 없는 도구는 null (instructions 카테고리를 건너뛴다) */
  instructionsFileName(): string | null;
  /** 현재 설치된 부품 스캔 (init의 근거) */
  scan(): Promise<ScannedComponent[]>;
}
