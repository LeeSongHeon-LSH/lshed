import { promises as fs } from "node:fs";
import path from "node:path";
import { type Ctx, manifestPath, INSTRUCTIONS, targetRel, MANIFEST_FILE, abs, ignoreOf } from "./context.js";
import { stringifyManifest, type Manifest } from "../manifest.js";
import { copyTree, exists } from "../fsutil.js";
import { writeState } from "../state.js";
import { isGenerated, instructionsFile } from "./instructions.js";

export interface InitResult { manifest: Manifest; copied: number; skipped: string[] }

/**
 * 현재 환경 스캔 → 창고에 복사 + lshed.yaml 생성 + state 기록.
 * 로컬 파일은 읽기만 한다 (§7.2). 쓰는 곳은 창고와 <root>/lshed/ 뿐이다. 창고에 이미 lshed.yaml 이 있으면 거부.
 */
export async function init(ctx: Ctx, opts: { profile?: string; exclude?: string[] } = {}): Promise<InitResult> {
  const profileName = opts.profile ?? "default";
  const exclude = opts.exclude ?? [];
  const skipped: string[] = [];
  if (await exists(manifestPath(ctx))) {
    throw new Error(`이미 초기화된 창고입니다: ${manifestPath(ctx)}\n  다른 환경의 설정을 이 창고로 가져오려면 'lshed restore' 후 'lshed save' 를 쓰세요.`);
  }
  const found = await ctx.adapter.scan();
  const m: Manifest = { version: 1, agent: ctx.adapter.name, components: {}, profiles: { [profileName]: {} } };
  const isExcluded = (cat: string, id: string) =>
    exclude.some((e) => e === id || e === `${cat}/${id}`);
  const managed: string[] = [];
  let copied = 0;

  for (const cat of ctx.adapter.categories()) {
    const mine = found.filter((f) => f.category === cat.name && !isExcluded(f.category, f.id));
    for (const f of found.filter((f) => f.category === cat.name && isExcluded(f.category, f.id))) {
      skipped.push(`${f.category}/${f.id}`);
      ctx.log(`  - ${f.category}/${f.id}  (--exclude)`);
    }
    if (!mine.length) continue;
    m.components[cat.name] = [];
    m.profiles[profileName][cat.name] = [];
    for (const f of mine) {
      const dst = path.join(ctx.shed, cat.root, cat.kind === "dir" ? f.id : `${f.id}.md`);
      await copyTree(f.path, dst, ignoreOf(ctx));
      m.components[cat.name].push({ id: f.id });
      m.profiles[profileName][cat.name].push(f.id);
      managed.push(targetRel(cat, f.id));
      copied++;
      ctx.log(`  + ${cat.name}/${f.id}`);
    }
  }

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
      m.components[INSTRUCTIONS] = [{ id: "main" }];
      m.profiles[profileName][INSTRUCTIONS] = ["main"];
      copied++;
      ctx.log(`  + ${INSTRUCTIONS}/main  (${path.basename(instr)})`);
    }
  }

  await fs.mkdir(ctx.shed, { recursive: true });
  await fs.writeFile(manifestPath(ctx), `# lshed manifest — edit freely. Reference: https://github.com/LeeSongHeon-LSH/lshed\n` + stringifyManifest(m));
  await writeState(ctx.adapter, { profile: profileName, shed: ctx.shed, managed, appliedAt: new Date().toISOString() });
  ctx.log(`\n${MANIFEST_FILE} 생성: ${manifestPath(ctx)}  (부품 ${copied}개${skipped.length ? `, 제외 ${skipped.length}개` : ""}, 프로필 "${profileName}")`);
  return { manifest: m, copied, skipped };
}
