/** 에이전트 어댑터 경계 (§4.6). 카테고리·경로·지침 전략은 전부 여기서 나온다. */
export interface Category {
  name: string;
  /** 어댑터 루트 기준 상대 경로 */
  root: string;
  /** dir: <root>/<id>/ 디렉터리, file: <root>/<id>.md 파일 */
  kind: "dir" | "file";
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
  /** 지침 파일: import 목록 생성 vs 단순 연결 (§3.3) */
  instructionsStrategy(): "import" | "concat";
  /** 지침 파일 이름 (루트 기준). 예: CLAUDE.md */
  instructionsFileName(): string;
  /** 현재 설치된 부품 스캔 (init의 근거) */
  scan(): Promise<ScannedComponent[]>;
}
