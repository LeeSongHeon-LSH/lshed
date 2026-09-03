import { promises as fs } from "node:fs";
import YAML from "yaml";
import { type Ctx, manifestPath, loadManifest } from "./context.js";
import { readState, writeState } from "../state.js";
import { readLock, writeLock } from "../lock.js";
import { discover, notInManifest, inManifestNotInProfile, keyOf, type Found, type Discovered } from "./discover.js";
import { ingest, tidy } from "./ingest.js";
import type { Manifest } from "../manifest.js";

export interface AddCandidates { fresh: Found[]; notInProfile: string[]; generated: Map<string, string> }

/** init 이후 이 환경에 새로 생긴 것. status 와 add 가 쓴다. */
export async function candidates(ctx: Ctx, m: Manifest, profile: string, d?: Discovered): Promise<AddCandidates> {
  d ??= await discover(ctx, m.exclude);
  return { fresh: notInManifest(m, d), notInProfile: inManifestNotInProfile(m, profile, d), generated: d.generated };
}

/**
 * 로컬에 새로 생긴 것을 창고에 넣는다 (init 의 증분판).
 * 키 없이 부르면 후보만 보여준다. 감지는 제안이고 확정은 사용자가 한다 (§3.7).
 * 넣은 부품은 현재 프로필과 관리 집합에 들어간다 — 이후 프로필 전환이 그것을 치울 수 있다는 뜻이다.
 */
export async function add(ctx: Ctx, keys: string[] = [], opts: { all?: boolean } = {}): Promise<string[]> {
  const state = await readState(ctx.adapter);
  if (!state) throw new Error("적용된 프로필이 없습니다. 먼저 'lshed init' 또는 'lshed restore <profile>' 을 실행하세요.");
  const m = await loadManifest(ctx);
  const c = await candidates(ctx, m, state.profile);

  if (!keys.length && !opts.all) {
    if (!c.fresh.length) ctx.log("창고에 없는 새 항목이 없습니다.");
    else {
      ctx.log(`창고에 없는 항목 ${c.fresh.length}개 (넣으려면 lshed add <key...> 또는 --all):`);
      for (const f of c.fresh) ctx.log(`  ${f.kind === "package" ? "≡" : " "} ${keyOf(f)}${f.kind === "package" ? `  ${f.pkg.source}` : f.kind === "entry" && f.warn ? `  ! ${f.warn}` : ""}`);
    }
    hint(ctx, c, state.profile);
    return [];
  }

  let chosen = c.fresh;
  if (keys.length) {
    chosen = keys.map((raw) => {
      const [a, b] = raw.includes("/") ? raw.split("/", 2) : [undefined, raw];
      const hits = c.fresh.filter((f) => f.id === b && (a === undefined || f.category === a));
      if (!hits.length) {
        const known = (m.components[a ?? ""] ?? []).some((x) => x.id === b) || Object.values(m.components).some((cs) => cs.some((x) => x.id === b)) || m.packages.some((p) => p.id === b);
        throw new Error(known ? `"${raw}" 는 이미 창고에 있습니다. 프로필에 넣으려면 lshed.yaml 의 profiles 를 고치세요.` : `"${raw}" 는 로컬에서 찾지 못했습니다. 'lshed add' 로 후보를 보세요.`);
      }
      if (hits.length > 1) throw new Error(`"${raw}" 가 모호합니다: ${hits.map(keyOf).join(", ")}`);
      return hits[0];
    });
  }
  if (!chosen.length) { ctx.log("창고에 없는 새 항목이 없습니다."); hint(ctx, c, state.profile); return []; }

  const doc = YAML.parseDocument(await fs.readFile(manifestPath(ctx), "utf8"));
  const lock = await readLock(ctx.shed);
  const res = await ingest(ctx, doc, state.profile, chosen, lock);
  tidy(doc);
  await fs.writeFile(manifestPath(ctx), doc.toString({ lineWidth: 0 }));
  if (res.packages.length) await writeLock(ctx.shed, lock);
  const managed = [...new Set([...state.managed, ...res.managed])].sort();
  await writeState(ctx.adapter, { ...state, managed, appliedAt: new Date().toISOString() });

  const added = chosen.map(keyOf);
  ctx.log(`\n${added.length}개를 창고에 넣고 프로필 "${state.profile}" 에 추가했습니다. 창고를 커밋하세요: ${ctx.shed}`);
  if (res.packages.some((id) => chosen.find((f) => f.id === id && f.kind === "package" && f.pkg.into))) ctx.log(`git 패키지의 설치 명령(install:)은 lshed.yaml 에서 직접 채우세요.`);
  hint(ctx, { ...c, fresh: c.fresh.filter((f) => !chosen.includes(f)) }, state.profile);
  return added;
}

function hint(ctx: Ctx, c: AddCandidates, profile: string): void {
  const byPkg = new Map<string, number>();
  for (const by of c.generated.values()) byPkg.set(by, (byPkg.get(by) ?? 0) + 1);
  for (const [by, n] of byPkg) ctx.log(`  · 패키지 ${by} 가 생성한 것 ${n}개는 담지 않습니다`);
  if (c.notInProfile.length) ctx.log(`창고에는 있지만 프로필 "${profile}" 이 안 쓰는 것 ${c.notInProfile.length}개: ${c.notInProfile.join(", ")}  → lshed.yaml 의 profiles 에 추가`);
}
