import { promises as fs } from "node:fs";
import path from "node:path";
import { type Ctx, manifestPath, INSTRUCTIONS, targetRel, MANIFEST_FILE, abs, ignoreOf } from "./context.js";
import { stringifyManifest, type Manifest } from "../manifest.js";
import { copyTree, exists } from "../fsutil.js";
import { writeState } from "../state.js";
import { isGenerated, instructionsFile } from "./instructions.js";
import { detectPackages, detectGenerated } from "./packages.js";
import { writeLock } from "../lock.js";
import { PACKAGES } from "../manifest.js";
import { mask, suspiciousStrings, placeholdersIn, writeEntryFile, type Json } from "./entries.js";

export interface InitResult { manifest: Manifest; copied: number; skipped: string[]; packages: string[]; generated: string[] }

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
  const all = await ctx.adapter.scan();
  const m: Manifest = { version: 1, agent: ctx.adapter.name, components: {}, packages: [], profiles: { [profileName]: {} } };
  const isExcluded = (cat: string, id: string) =>
    exclude.some((e) => e === id || e === `${cat}/${id}`);

  // 세 종류로 가른다 (§3.7): 설치한 것 / 설치가 만들어낸 것 / 내가 쓴 것
  const pkgs = (await detectPackages(ctx, all)).filter((p) => !isExcluded("", p.id));
  const generated = await detectGenerated(all, pkgs);
  const found = all.filter((f) => !pkgs.some((p) => p.path === f.path) && !generated.has(`${f.category}/${f.id}`));
  for (const p of pkgs) {
    m.packages.push(p.into ? { id: p.id, source: p.source, into: p.into } : { id: p.id, source: p.source });
    const rev = /^[0-9a-f]{40}$/.test(p.rev) ? p.rev.slice(0, 7) : p.rev;
    ctx.log(`  ≡ package ${p.id}  ${p.source} @${rev}  (참조만 기록)`);
  }
  if (pkgs.length) m.profiles[profileName][PACKAGES] = pkgs.map((p) => p.id);
  for (const [key, by] of generated) ctx.log(`  · ${key}  (${by} 가 생성한 것 → 건너뜀)`);
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

  // 항목형 (MCP 등): 시크릿은 자리표시자로 바꿔 담는다 (§7.1)
  for (const cat of ctx.adapter.entries()) {
    const all = await cat.read();
    const ids = Object.keys(all).sort();
    for (const id of ids.filter((id) => isExcluded(cat.name, id))) {
      skipped.push(`${cat.name}/${id}`);
      ctx.log(`  - ${cat.name}/${id}  (--exclude)`);
    }
    const mine = ids.filter((id) => !isExcluded(cat.name, id));
    if (!mine.length) continue;
    m.components[cat.name] = [];
    m.profiles[profileName][cat.name] = [];
    for (const id of mine) {
      if (!/^[\w.-]+$/.test(id)) { ctx.log(`  ! ${cat.name}/${id}: 이름에 쓸 수 없는 문자가 있어 건너뜀`); continue; }
      const masked = mask(id, all[id] as Json, cat);
      await writeEntryFile(path.join(ctx.shed, cat.name, `${id}.json`), masked);
      m.components[cat.name].push({ id });
      m.profiles[profileName][cat.name].push(id);
      managed.push(targetRel(cat, id));
      copied++;
      const vars = placeholdersIn(masked);
      ctx.log(`  + ${cat.name}/${id}${vars.length ? `  (시크릿 → ${vars.map((v) => "${" + v + "}").join(", ")})` : ""}`);
      for (const where of suspiciousStrings(masked)) ctx.log(`    ! ${where} 가 시크릿처럼 보입니다. 창고의 ${cat.name}/${id}.json 에서 \${VAR} 로 바꾸세요`);
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
  let yamlText = stringifyManifest(m);
  // 설치 명령은 자동으로 알 수 없다. 사용자가 채울 자리를 남긴다.
  for (const p of pkgs) {
    if (!p.into) continue; // 어댑터 설치기 패키지는 자기 설치법을 안다
    yamlText = yamlText.replace(`    into: ${p.into}\n`, `    into: ${p.into}\n    # install: ./setup    # ← 복원 후 실행할 명령이 있으면 채우세요 (--yes 로 실행)\n`);
  }
  await fs.writeFile(manifestPath(ctx), `# lshed manifest — edit freely. Reference: https://github.com/LeeSongHeon-LSH/lshed\n` + yamlText);
  if (pkgs.length) {
    await writeLock(ctx.shed, { version: 1, packages: Object.fromEntries(pkgs.map((p) => [p.id, { source: p.source, rev: p.rev }])) });
  }
  await writeState(ctx.adapter, { profile: profileName, shed: ctx.shed, managed, appliedAt: new Date().toISOString() });
  const parts = [`부품 ${copied}개`];
  if (pkgs.length) parts.push(`패키지 ${pkgs.length}개`);
  if (generated.size) parts.push(`생성물 ${generated.size}개 건너뜀`);
  if (skipped.length) parts.push(`제외 ${skipped.length}개`);
  ctx.log(`\n${MANIFEST_FILE} 생성: ${manifestPath(ctx)}  (${parts.join(", ")}, 프로필 "${profileName}")`);
  if (pkgs.some((p) => p.into)) ctx.log(`git 패키지의 설치 명령(install:)은 lshed.yaml 에서 직접 채우세요.`);
  return { manifest: m, copied, skipped, packages: pkgs.map((p) => p.id), generated: [...generated.keys()] };
}
