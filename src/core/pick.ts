import { promises as fs } from "node:fs";
import os from "node:os";
import YAML from "yaml";
import { type Ctx, INSTRUCTIONS, loadManifest, manifestPath, knownCategories } from "./context.js";
import { PACKAGES, resolveProfile, type Manifest } from "../manifest.js";
import { readState } from "../state.js";
import { restore, type RestoreOptions, type RestoreResult } from "./restore.js";

export interface PickOption { id: string; hint?: string; checked: boolean }
/** 체크리스트 한 화면 = 카테고리 하나. 창고에 그 카테고리가 비어 있으면 화면 자체가 없다. */
export interface PickGroup { category: string; title: string; options: PickOption[] }

/** 터미널 상호작용. CLI 는 @clack/prompts 로 채우고 테스트는 가짜로 채운다. undefined 는 사용자가 취소한 것. */
export interface Prompter {
  multiselect(group: PickGroup): Promise<string[] | undefined>;
  text(message: string, defaultValue: string, validate: (v: string) => string | undefined): Promise<string | undefined>;
  confirm(message: string): Promise<boolean | undefined>;
}

export interface PickOptions extends Omit<RestoreOptions, "manifest"> {
  /** 미리 체크해 둘 프로필. 없으면 마지막으로 적용한 프로필, 그것도 없으면 전부 해제 */
  base?: string;
  /** 저장할 프로필 이름. 없으면 물어본다 (기본값은 호스트명) */
  name?: string;
}

export interface PickResult { profile: string; selection: Record<string, string[]>; restored: RestoreResult | null }

const PROFILE_NAME_RE = /^[\w.-]+$/;

/**
 * 카테고리 순서: 패키지 → 어댑터 파일 카테고리(skills, agents, commands) → 지침 → 항목형(mcp, settings).
 * 패키지가 먼저인 이유는 restore 도 패키지를 먼저 놓기 때문이다. 지침 조각은 순서가 의미이므로 매니페스트 순서를 지킨다.
 */
export function pickGroups(ctx: Ctx, m: Manifest, base?: Record<string, string[]>): PickGroup[] {
  const order = [PACKAGES, ...ctx.adapter.categories().map((c) => c.name), INSTRUCTIONS, ...ctx.adapter.entries().map((e) => e.name)];
  const groups: PickGroup[] = [];
  for (const cat of order) {
    const checked = new Set(base?.[cat] ?? []);
    const options: PickOption[] = cat === PACKAGES
      ? m.packages.map((p) => ({ id: p.id, hint: p.source, checked: checked.has(p.id) }))
      : (m.components[cat] ?? []).map((c) => ({ id: c.id, hint: c.tags?.join(", "), checked: checked.has(c.id) }));
    if (!options.length) continue;
    groups.push({ category: cat, title: `${cat} (${options.length})`, options });
  }
  return groups;
}

/** 호스트명을 프로필 이름으로. "Lees-MacBook.local" → "lees-macbook.local" */
export function defaultProfileName(host = os.hostname()): string {
  const s = host.toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return PROFILE_NAME_RE.test(s) ? s : "picked";
}

export function validateProfileName(v: string): string | undefined {
  if (!v) return undefined; // 빈 입력은 기본값
  return PROFILE_NAME_RE.test(v) ? undefined : "only letters, digits and ._- are allowed";
}

/**
 * 창고의 부품을 카테고리별 체크리스트로 고르고, 그 선택을 프로필로 저장한 뒤 restore 한다.
 * 임시 선택으로 두지 않는 이유: 다음 `lshed restore` 가 같은 선택을 다시 적용해야 하고, sync 로 다른 기기에서도 보여야 한다 (창고가 진실).
 * dry-run 이면 lshed.yaml 도 쓰지 않는다. 취소하면 null.
 */
export async function pick(ctx: Ctx, prompter: Prompter, opts: PickOptions = {}): Promise<PickResult | null> {
  const state = await readState(ctx.adapter);
  const m = await loadManifest(ctx);
  const baseName = opts.base ?? state?.profile;
  if (baseName && !m.profiles[baseName]) {
    const names = Object.keys(m.profiles);
    throw new Error(`no profile "${baseName}". Profiles: ${names.length ? names.join(", ") : "(none)"}`);
  }
  const groups = pickGroups(ctx, m, baseName ? resolveProfile(m, baseName) : undefined);
  if (!groups.length) throw new Error(`Nothing to pick from in the shed: ${ctx.shed}`);
  const unknown = Object.keys(m.components).filter((c) => !knownCategories(ctx.adapter).includes(c));
  if (unknown.length) ctx.log(`  · ${ctx.adapter.name} does not handle ${unknown.join(", ")}, so they are not offered here (they apply when restoring with another agent)`);

  ctx.log(`shed: ${ctx.shed}  (${groups.map((g) => g.title).join(", ")})${baseName ? `  base profile: ${baseName}` : ""}`);
  const selection: Record<string, string[]> = {};
  for (const g of groups) {
    const ids = await prompter.multiselect(g);
    if (ids === undefined) return cancelled(ctx);
    const set = new Set(ids);
    const chosen = g.options.filter((o) => set.has(o.id)).map((o) => o.id); // 매니페스트 순서 유지
    if (chosen.length) selection[g.category] = chosen;
  }
  if (!Object.keys(selection).length) {
    ctx.log("Nothing picked. Nothing changed.");
    return null;
  }

  let name = opts.name;
  if (!name) {
    const typed = await prompter.text("Profile name to save this selection as", defaultProfileName(), validateProfileName);
    if (typed === undefined) return cancelled(ctx);
    name = typed || defaultProfileName();
  }
  const err = validateProfileName(name);
  if (err) throw new Error(`profile name "${name}": ${err}`);
  if (m.profiles[name] && !opts.dryRun) {
    const ok = await prompter.confirm(`Profile "${name}" already exists. Overwrite it with this selection?`);
    if (!ok) return cancelled(ctx);
  }

  m.profiles[name] = selection;
  if (opts.dryRun) {
    ctx.log(`\n(dry-run) profile "${name}" was not written to lshed.yaml:`);
    for (const [cat, ids] of Object.entries(selection)) ctx.log(`  ${cat}: ${ids.join(", ")}`);
    ctx.log("");
  } else {
    const doc = YAML.parseDocument(await fs.readFile(manifestPath(ctx), "utf8"));
    doc.setIn(["profiles", name], doc.createNode(selection));
    await fs.writeFile(manifestPath(ctx), doc.toString({ lineWidth: 0 }));
    ctx.log(`\nProfile "${name}" saved to lshed.yaml. To use it on other machines, push it with lshed sync.\n`);
  }

  const restored = await restore(ctx, name, { dryRun: opts.dryRun, backup: opts.backup, yes: opts.yes, link: opts.link, manifest: m });
  return { profile: name, selection, restored };
}

function cancelled(ctx: Ctx): null {
  ctx.log("Cancelled. Nothing changed.");
  return null;
}
