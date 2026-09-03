import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { type Ctx, manifestPath, INSTRUCTIONS, targetRel, MANIFEST_FILE, abs, ignoreOf } from "./context.js";
import { parseManifest, type Manifest } from "../manifest.js";
import { copyTree, exists } from "../fsutil.js";
import { writeState } from "../state.js";
import { isGenerated, instructionsFile } from "./instructions.js";
import { writeLock, type Lock } from "../lock.js";
import { discover } from "./discover.js";
import { ingest, tidy } from "./ingest.js";

export interface InitResult { manifest: Manifest; copied: number; skipped: string[]; packages: string[]; generated: string[] }

export const MANIFEST_HEADER = "# lshed manifest — edit freely. Reference: https://github.com/LeeSongHeon-LSH/lshed\n";

/**
 * 현재 환경 스캔 → 창고에 복사 + lshed.yaml 생성 + state 기록.
 * 로컬 파일은 읽기만 한다 (§7.2). 쓰는 곳은 창고와 <root>/lshed/ 뿐이다. 창고에 이미 lshed.yaml 이 있으면 거부.
 */
export async function init(ctx: Ctx, opts: { profile?: string; exclude?: string[] } = {}): Promise<InitResult> {
  const profileName = opts.profile ?? "default";
  if (await exists(manifestPath(ctx))) {
    throw new Error(`이미 초기화된 창고입니다: ${manifestPath(ctx)}\n  이 환경에 새로 생긴 것을 기존 창고에 넣으려면 'lshed add' 를, 다른 환경의 설정을 가져오려면 'lshed restore' 후 'lshed save' 를 쓰세요.`);
  }

  // 세 종류로 가른다 (§3.7): 설치한 것 / 설치가 만들어낸 것 / 내가 쓴 것
  const d = await discover(ctx, opts.exclude);
  for (const [key, by] of d.generated) ctx.log(`  · ${key}  (${by} 가 생성한 것 → 건너뜀)`);
  for (const key of d.excluded) ctx.log(`  - ${key}  (--exclude)`);

  const exclude = opts.exclude?.length ? { exclude: [...opts.exclude] } : {};
  const doc = new YAML.Document({ version: 1, agent: ctx.adapter.name, ...exclude, components: {}, packages: [], profiles: { [profileName]: {} } });
  const lock: Lock = { version: 1, packages: {} };
  await fs.mkdir(ctx.shed, { recursive: true });
  const res = await ingest(ctx, doc, profileName, d.items, lock);
  const managed = [...res.managed];
  let copied = res.copied;

  // 기존 지침 파일: lshed 생성물이 아니면 조각 "main" 으로 가져온다
  const instr = instructionsFile(ctx);
  if (await exists(instr)) {
    const text = await fs.readFile(instr, "utf8");
    if (!isGenerated(text)) {
      const dst = path.join(ctx.shed, INSTRUCTIONS, "main.md");
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.writeFile(dst, text);
      // lshed 전용 디렉터리에도 조각을 둔다. 지침 파일 자체는 첫 restore 가 import 목록으로 바꾼다.
      const fragRel = targetRel(INSTRUCTIONS, "main");
      await copyTree(dst, abs(ctx, fragRel), ignoreOf(ctx));
      managed.push(fragRel);
      doc.setIn(["components", INSTRUCTIONS], [{ id: "main" }]);
      doc.setIn(["profiles", profileName, INSTRUCTIONS], ["main"]);
      copied++;
      ctx.log(`  + ${INSTRUCTIONS}/main  (${path.basename(instr)})`);
    }
  }

  tidy(doc);
  const yamlText = MANIFEST_HEADER + doc.toString({ lineWidth: 0 });
  await fs.writeFile(manifestPath(ctx), yamlText);
  if (res.packages.length) await writeLock(ctx.shed, lock);
  await writeState(ctx.adapter, { profile: profileName, shed: ctx.shed, managed, appliedAt: new Date().toISOString() });

  const parts = [`부품 ${copied}개`];
  if (res.packages.length) parts.push(`패키지 ${res.packages.length}개`);
  if (d.generated.size) parts.push(`생성물 ${d.generated.size}개 건너뜀`);
  if (d.excluded.length) parts.push(`제외 ${d.excluded.length}개`);
  ctx.log(`\n${MANIFEST_FILE} 생성: ${manifestPath(ctx)}  (${parts.join(", ")}, 프로필 "${profileName}")`);
  if (d.items.some((f) => f.kind === "package" && f.pkg.into)) ctx.log(`git 패키지의 설치 명령(install:)은 lshed.yaml 에서 직접 채우세요.`);
  const manifest = parseManifest(yamlText);
  return { manifest, copied, skipped: d.excluded, packages: res.packages, generated: [...d.generated.keys()] };
}
