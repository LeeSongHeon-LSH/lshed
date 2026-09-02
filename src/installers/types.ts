import type { Ctx } from "../core/context.js";
import type { Package } from "../manifest.js";
import type { ScannedComponent } from "../adapters/types.js";

/** init 이 발견한 "설치한 것" */
export interface DetectedPackage {
  id: string;
  source: string;
  into?: string;
  /** 지금 설치된 정확한 버전/커밋 → 락 */
  rev: string;
  /** 디스크 위치 (git 계열). 생성물 감지에 쓴다 */
  path?: string;
}

export interface PkgStatus { present: boolean; rev?: string }
export interface InstallOpts { dryRun?: boolean; yes?: boolean }

/**
 * 패키지 설치기 (§3.7). 스킴별로 하나. git 계열은 core 가, 나머지는 어댑터가 제공한다.
 * 규칙: 이미 있으면 install 은 불리지 않는다. 락 버전을 못 맞추면 실제 버전을 돌려주고 락이 따라간다.
 */
export interface Installer {
  readonly name: string;
  readonly schemes: readonly string[];
  /** 낮을수록 먼저 설치. 마켓플레이스(10) < 플러그인(20). git 은 0 */
  readonly priority: number;
  detect(ctx: Ctx, found: ScannedComponent[]): Promise<DetectedPackage[]>;
  status(ctx: Ctx, pkg: Package): Promise<PkgStatus>;
  /** 없을 때만. locked 가 있으면 맞추려 시도. 실제 rev 반환 */
  install(ctx: Ctx, pkg: Package, locked: string | undefined, opts: InstallOpts): Promise<string>;
  /** 최신으로. 실제 rev 반환 */
  update(ctx: Ctx, pkg: Package, opts: InstallOpts): Promise<string>;
  /** 로그·dry-run 용 한 줄 */
  describe(pkg: Package, locked?: string): string;
  /** install: 셸 명령의 작업 디렉터리 */
  cwd(ctx: Ctx, pkg: Package): string;
}
