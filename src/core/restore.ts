import { promises as fs } from "node:fs";
import path from "node:path";
import { type Ctx, type PlanItem, loadManifest, planProfile, abs, INSTRUCTIONS, ignoreOf, entryOf, unsupportedCategories, installablePackages, schemeOf } from "./context.js";
import { expand, envWithHome, matches, placeholdersIn, readEntryFile, writeEntryFile, type Json } from "./entries.js";
import { readState, writeState, LSHED_DIR } from "../state.js";
import { copyTree, exists, hashTree, isLink, isLinkTo, linkTree, removeTree } from "../fsutil.js";
import { instructionsFile, isGenerated, renderInstructions } from "./instructions.js";
import { ensurePackages, reportPending } from "./packages.js";
import type { Manifest } from "../manifest.js";

export interface RestoreOptions {
  dryRun?: boolean;
  backup?: boolean;
  yes?: boolean;
  /** 파일 부품을 복사 대신 링크로 놓는다 (§3.6). 생략하면 이 기기가 마지막에 쓴 방식, 처음이면 복사. */
  link?: boolean;
  /** 이미 읽은(또는 아직 쓰지 않은) 매니페스트로 계획한다. pick 의 dry-run 이 쓴다. */
  manifest?: Manifest;
}
export interface RestoreResult {
  profile: string;
  placed: string[];
  removed: string[];
  backedUp: string[];
  backupDir: string | null;
  /** 배치한 항목이 참조하는데 지금 환경에 없는 변수 */
  missingEnv: { rel: string; vars: string[] }[];
}

/**
 * 프로필 적용 (§3.5).
 *  - 새 계획에 있는 항목은 복사한다 (기존 파일이 다르면 백업 후). --link 면 창고로 가는 링크를 놓는다 (§3.6).
 *  - 이전 관리 집합에 있었지만 새 계획에 없는 항목만 제거한다 (백업 후).
 *  - 관리 집합에 없는 사용자 파일은 건드리지 않는다.
 */
export async function restore(ctx: Ctx, profileArg: string | undefined, opts: RestoreOptions = {}): Promise<RestoreResult> {
  const backup = opts.backup ?? true;
  const state = await readState(ctx.adapter);
  const profile = profileArg ?? state?.profile;
  if (!profile) throw new Error("프로필을 지정하세요: lshed restore <profile>  (이전에 적용한 프로필이 없습니다)");
  const link = opts.link ?? state?.link ?? false;

  const m = opts.manifest ?? await loadManifest(ctx);
  const plan = planProfile(ctx, m, profile);
  for (const it of plan) {
    if (!(await exists(it.src))) throw new Error(`${it.category}/${it.id}: 창고에 파일이 없습니다: ${it.src}`);
  }
  // 창고 하나를 여러 에이전트가 쓴다 (§4.6). 이 에이전트가 모르는 카테고리·설치기 없는 패키지는 조용히가 아니라 알리고 건너뛴다.
  const skippedCats = unsupportedCategories(ctx, m, profile);
  if (skippedCats.length) ctx.log(`  · ${ctx.adapter.name} 은 ${skippedCats.join(", ")} 를 다루지 않아 건너뜁니다`);
  const pk = installablePackages(ctx, m, profile);
  for (const p of pk.skipped) ctx.log(`  · package ${p.id}  (${schemeOf(p.source)}: 는 ${ctx.adapter.name} 로 설치할 수 없어 건너뜀)`);

  // 0) 패키지 먼저. 생성물이 있어야 하는 부품이 있을 수 있다. 관리 집합에는 넣지 않는다.
  const pkgRes = await ensurePackages(ctx, pk.packages, { dryRun: opts.dryRun, yes: opts.yes });

  const instrRel = ctx.adapter.instructionsFileName();
  // 지침 파일이 없는 어댑터는 planProfile 이 instructions 를 이미 뺐다
  const fragments = instrRel ? plan.filter((p) => p.category === INSTRUCTIONS) : [];
  const newManaged = new Set(plan.map((p) => p.rel));
  if (fragments.length && instrRel) newManaged.add(instrRel);
  const oldManaged = new Set(state?.managed ?? []);
  const toRemove = [...oldManaged].filter((r) => !newManaged.has(r)).sort();

  // 관리 집합은 "이 창고가 놓은 것" 이다. 창고가 바뀌면 그 목록은 다른 창고의 것이라 제거 근거가 약하다.
  // 다른 창고로 갈아타는 흔한 경로가 "탐색용 init 뒤 진짜 창고 restore" 이고, 그때 이 기기의 부품이 제거 대상이 된다.
  if (state && state.shed !== ctx.shed && toRemove.length) {
    ctx.log(`! 마지막으로 적용한 창고가 다릅니다: ${state.shed}`);
    ctx.log(`  아래 ${toRemove.length}개는 그 창고의 관리 목록에 있어 제거 대상입니다 (백업됨). 이 기기의 것을 지키려면 먼저 'lshed add' 로 창고에 넣으세요.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(ctx.adapter.root, LSHED_DIR, "backups", stamp);
  const backedUp: string[] = [];
  const placed: string[] = [];
  const missingEnv: { rel: string; vars: string[] }[] = [];
  const localEntries = new Map<string, Record<string, unknown>>();
  const entriesOf = async (cat: { name: string; read(): Promise<Record<string, unknown>> }) => {
    if (!localEntries.has(cat.name)) localEntries.set(cat.name, await cat.read());
    return localEntries.get(cat.name)!;
  };

  async function backUp(rel: string) {
    const en = entryOf(ctx, rel);
    if (en) {
      const cur = (await entriesOf(en.cat))[en.id];
      if (cur === undefined) return;
      backedUp.push(rel);
      if (opts.dryRun || !backup) return;
      await writeEntryFile(path.join(backupDir, en.cat.name, `${en.id}.json`), cur as Json);
      return;
    }
    const from = abs(ctx, rel);
    if (!(await exists(from))) return;
    backedUp.push(rel);
    if (opts.dryRun || !backup) return;
    await copyTree(from, path.join(backupDir, ...rel.split("/").map((seg) => (seg === ".." ? "__" : seg))), ignoreOf(ctx));
  }

  // 1) 제거 대상 (이전 프로필에만 있던 것)
  for (const rel of toRemove) {
    ctx.log(`  - ${rel}`);
    await backUp(rel);
    if (opts.dryRun) continue;
    const en = entryOf(ctx, rel);
    if (en) await en.cat.write(en.id, null);
    else await removeTree(abs(ctx, rel));
  }

  // 2) 배치
  for (const it of plan) {
    if (it.entry) {
      // 항목형: 설정 파일의 그 키만 바꾼다. 자리표시자는 에이전트가 확장하면 그대로, 아니면 여기서 채운다.
      const shed = (await readEntryFile(it.src))!;
      const local = (await entriesOf(it.entry))[it.id] as Json | undefined;
      const vars = placeholdersIn(shed).filter((v) => v !== "HOME");
      const ex = expand(shed, envWithHome());
      if (ex.missing.length) missingEnv.push({ rel: it.rel, vars: ex.missing });
      const value = it.entry.expandsEnv ? shed : ex.value;
      const same = local !== undefined && matches(shed, local);
      const mark = same ? "=" : local !== undefined ? "~" : "+";
      ctx.log(`  ${mark} ${it.rel}${vars.length ? `  (${vars.map((v) => "${" + v + "}").join(", ")})` : ""}`);
      if (same) { placed.push(it.rel); continue; }
      if (local !== undefined) await backUp(it.rel);
      if (!opts.dryRun) await it.entry.write(it.id, value);
      placed.push(it.rel);
      continue;
    }
    const target = abs(ctx, it.rel);
    const there = (await exists(target)) || (await isLink(target)); // 끊어진 링크도 "있는 것" 으로 치워야 한다
    const sameContent = there && (await hashTree(target, ignoreOf(ctx))) === (await hashTree(it.src, ignoreOf(ctx)));
    const isLinked = await isLinkTo(target, it.src);
    // 링크 모드면 창고를 가리키는 링크여야 같은 것이고, 복사 모드면 링크가 아니면서 내용이 같아야 같은 것이다.
    const same = link ? isLinked : sameContent && !(await isLink(target));
    const note = link ? "  (link)" : (await isLink(target)) ? "  (link → 복사)" : "";
    const mark = same ? "=" : there ? "~" : "+";
    ctx.log(`  ${mark} ${it.rel}${same ? "" : note}`);
    if (same) { placed.push(it.rel); continue; }
    if (there && !sameContent) await backUp(it.rel); // 관리 여부와 무관하게 내용이 다르면 백업
    if (!opts.dryRun) {
      if (!link) await copyTree(it.src, target, ignoreOf(ctx));
      else if ((await linkTree(it.src, target, ignoreOf(ctx))) === "copy") {
        ctx.log(`    ! 링크를 만들 수 없어 복사했습니다. 편집은 lshed save 로 반영하세요${process.platform === "win32" ? " (Windows 파일 링크는 개발자 모드가 필요합니다)" : ""}`);
      }
    }
    placed.push(it.rel);
  }

  // 3) 지침 파일
  const instrPath = instructionsFile(ctx);
  if (fragments.length && instrRel && instrPath) {
    const contents: { id: string; content: string }[] = [];
    for (const f of fragments) contents.push({ id: f.id, content: await fs.readFile(f.src, "utf8") });
    const rendered = renderInstructions(ctx, profile, contents);
    const existing = (await exists(instrPath)) ? await fs.readFile(instrPath, "utf8") : null;
    if (existing !== rendered) {
      const mark = existing === null ? "+" : "~";
      ctx.log(`  ${mark} ${instrRel}${existing !== null && !isGenerated(existing) ? "  (기존 파일은 lshed 생성물이 아님 → 백업)" : ""}`);
      if (existing !== null) await backUp(instrRel);
      if (!opts.dryRun) await fs.writeFile(instrPath, rendered);
    } else {
      ctx.log(`  = ${instrRel}`);
    }
    placed.push(instrRel);
  }

  if (opts.dryRun) {
    ctx.log(`\n(dry-run) 변경 없음. 배치 ${placed.length}, 제거 ${toRemove.length}, 백업 예정 ${backedUp.length}`);
    reportPending(ctx, pkgRes);
    reportMissingEnv(ctx, missingEnv);
    return { profile, placed, removed: toRemove, backedUp, backupDir: null, missingEnv };
  }

  await writeState(ctx.adapter, { profile, shed: ctx.shed, managed: [...newManaged].sort(), appliedAt: new Date().toISOString(), ...(link ? { link } : {}) });
  const bdir = backup && backedUp.length ? backupDir : null;
  ctx.log(`\n프로필 "${profile}" 적용${link ? " (link)" : ""}: 배치 ${placed.length}, 제거 ${toRemove.length}${pkgRes.installed.length ? `, 패키지 설치 ${pkgRes.installed.length}` : ""}${bdir ? `, 백업 ${backedUp.length} → ${bdir}` : ""}`);
  reportPending(ctx, pkgRes);
  reportMissingEnv(ctx, missingEnv);
  return { profile, placed, removed: toRemove, backedUp, backupDir: bdir, missingEnv };
}

export function reportMissingEnv(ctx: Ctx, missing: { rel: string; vars: string[] }[]): void {
  if (!missing.length) return;
  ctx.log(`\n환경변수가 없는 항목이 있습니다. 시크릿 값은 창고에 담지 않으므로 이 기기의 셸 환경에 넣으세요 (예: ~/.zshrc 의 export):`);
  for (const m of missing) ctx.log(`  ${m.rel}: ${m.vars.join(", ")}`);
}
