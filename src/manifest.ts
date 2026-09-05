import { z } from "zod";
import YAML from "yaml";
import { parseSource, isComponentSource } from "./source.js";

/** id 는 경로 구간을 가질 수 있다 (agents/team/reviewer.md → "team/reviewer"). 구간마다 영문·숫자·._- */
const ID_RE = /^[\w.-]+(?:\/[\w.-]+)*$/;

/**
 * "category/id" 또는 "id" → 카테고리(없을 수 있음)와 id.
 * id 자체에 '/' 가 들어갈 수 있으므로 첫 '/' 에서만 나눈다. 카테고리 이름에는 '/' 가 없다.
 */
export function parseKey(raw: string): { category?: string; id: string } {
  const i = raw.indexOf("/");
  return i < 0 ? { id: raw } : { category: raw.slice(0, i), id: raw.slice(i + 1) };
}

/** 부품 하나. source 생략 시 file:./<category>/<id> (§3.2 관례). */
const ComponentSchema = z.object({
  id: z.string().regex(ID_RE, "id는 영문·숫자·._- 와 구간 사이의 / 만 허용"),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

/**
 * 설치한 것 (§3.7). 내용을 복사하지 않고 출처만 기록한다. 복원 시 clone 하고 install 을 돌린다.
 * into 는 어댑터 루트 기준 상대 경로. 패키지는 관리 집합에 들어가지 않는다.
 */
const PackageSchema = z.object({
  id: z.string().regex(/^[\w.@-]+$/, "id는 영문·숫자·._@- 만 허용"),   // 패키지 id 는 경로가 아니다. 플러그인은 "이름@마켓플레이스" 로 구분될 수 있다
  source: z.string(),
  /** git 계열 패키지의 위치 (어댑터 루트 기준). 어댑터 설치기 스킴은 필요 없다 */
  into: z.string().regex(/^[^/\\][^\\]*$/, "into 는 루트 기준 상대 경로 (POSIX)").optional(),
  /** 설치 후 실행할 셸 명령. --yes 일 때만 실행 */
  install: z.string().optional(),
});
export type Package = z.infer<typeof PackageSchema>;
export const PACKAGES = "packages";

/** 카테고리 이름은 어댑터가 정한다. 스키마는 이름을 고정하지 않는다 (§4.1). */
const ComponentsSchema = z.record(z.string(), z.array(ComponentSchema));
/**
 * 프로필 = 카테고리 → id 목록. `extends` 키만 예외로 부모 프로필 이름(들)이다.
 * `extends: base` 도 받아 `["base"]` 로 정규화한다. 카테고리 이름은 어댑터가 정하므로 "extends" 는 카테고리가 될 수 없다.
 */
export const EXTENDS = "extends";
const ProfileSchema = z.preprocess(
  (v) => (v && typeof v === "object" && !Array.isArray(v) && typeof (v as Record<string, unknown>)[EXTENDS] === "string"
    ? { ...(v as Record<string, unknown>), [EXTENDS]: [(v as Record<string, unknown>)[EXTENDS]] }
    : v),
  z.record(z.string(), z.array(z.string())),
);
export type Profile = z.infer<typeof ProfileSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  agent: z.string().default("claude-code"),
  /** 창고에 담지 않을 이름들. 기본값(DEFAULT_IGNORE)에 더해진다. */
  ignore: z.array(z.string()).optional(),
  /** 로컬에 있어도 창고에 넣지 않을 부품 ("id" 또는 "category/id"). init --exclude 가 적고 add/status 가 따른다. */
  exclude: z.array(z.string()).optional(),
  components: ComponentsSchema.default({}),
  packages: z.array(PackageSchema).default([]),
  profiles: z.record(z.string(), ProfileSchema).default({}),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export class ManifestError extends Error {}

/** YAML 문자열 → 검증된 매니페스트. 참조 무결성까지 확인한다. */
export function parseManifest(text: string, knownCategories?: readonly string[], knownSchemes?: readonly string[]): Manifest {
  const raw = YAML.parse(text);
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ManifestError(`lshed.yaml 형식 오류:\n${lines.join("\n")}`);
  }
  const m = result.data;
  const problems: string[] = [];

  for (const [cat, comps] of Object.entries(m.components)) {
    if (knownCategories && !knownCategories.includes(cat)) {
      problems.push(`알 수 없는 카테고리 "${cat}" (어댑터 ${m.agent}: ${knownCategories.join(", ")})`);
    }
    const seen = new Set<string>();
    for (const c of comps) {
      if (seen.has(c.id)) problems.push(`${cat}: id "${c.id}" 중복`);
      seen.add(c.id);
      try {
        if (!isComponentSource(parseSource(effectiveSource(cat, c)))) problems.push(`${cat}/${c.id}: 부품 출처는 file:/github:/git: 이어야 합니다`);
      } catch (e) {
        problems.push(`${cat}/${c.id}: ${(e as Error).message}`);
      }
    }
  }

  const pkgIds = new Set<string>();
  for (const p of m.packages) {
    if (pkgIds.has(p.id)) problems.push(`packages: id "${p.id}" 중복`);
    pkgIds.add(p.id);
    try {
      const src = parseSource(p.source);
      const scheme = src.scheme === "other" ? src.name : src.scheme;
      if (scheme === "file") problems.push(`packages/${p.id}: 패키지 출처는 file: 일 수 없습니다`);
      else if (knownSchemes && !knownSchemes.includes(scheme)) problems.push(`packages/${p.id}: 스킴 "${scheme}" 을 다룰 설치기가 없습니다 (${knownSchemes.join(", ")})`);
      if ((scheme === "github" || scheme === "git") && !p.into) problems.push(`packages/${p.id}: ${scheme}: 패키지는 into 가 필요합니다`);
    } catch (e) {
      problems.push(`packages/${p.id}: ${(e as Error).message}`);
    }
  }

  for (const [profile, cats] of Object.entries(m.profiles)) {
    for (const parent of cats[EXTENDS] ?? []) {
      if (!(parent in m.profiles)) problems.push(`profiles.${profile}.extends: 프로필 "${parent}" 이 없음`);
    }
    if (cats[EXTENDS]?.length) {
      const cycle = findCycle(m, profile);
      if (cycle) problems.push(`profiles.${profile}.extends: 순환 상속 (${cycle.join(" → ")})`);
    }
    for (const [cat, ids] of Object.entries(cats)) {
      if (cat === EXTENDS) continue;
      if (cat === PACKAGES) {
        for (const id of ids) if (!pkgIds.has(id)) problems.push(`profiles.${profile}.packages: "${id}" 는 packages 에 없음`);
        continue;
      }
      const available = new Set((m.components[cat] ?? []).map((c) => c.id));
      for (const id of ids) {
        if (!available.has(id)) problems.push(`profiles.${profile}.${cat}: "${id}" 는 components에 없음`);
      }
    }
  }

  if (problems.length) throw new ManifestError(`lshed.yaml 참조 오류:\n${problems.map((p) => "  " + p).join("\n")}`);
  return m;
}

/** source 생략 시 관례: file:./<category>/<id> (dir), <id>.md (file), <id>.json (entry) */
export function effectiveSource(category: string, c: Component, kind: "dir" | "file" | "entry" = "dir"): string {
  const ext = kind === "file" ? ".md" : kind === "entry" ? ".json" : "";
  return c.source ?? `file:./${category}/${c.id}${ext}`;
}

export function stringifyManifest(m: Manifest): string {
  // 빈 목록은 쓰지 않는다. 사용자가 손으로 고치는 파일이라 잡음을 줄인다.
  const out: Record<string, unknown> = { ...m };
  if (!m.packages.length) delete out.packages;
  if (!m.ignore?.length) delete out.ignore;
  if (!m.exclude?.length) delete out.exclude;
  return YAML.stringify(out, { lineWidth: 0 });
}

/** 프로필 이름에서 시작해 extends 를 따라가다 자기 자신으로 돌아오면 그 경로. 없으면 null */
function findCycle(m: Manifest, start: string, path: string[] = [start]): string[] | null {
  for (const parent of m.profiles[path[path.length - 1]]?.[EXTENDS] ?? []) {
    if (parent === start) return [...path, parent];
    if (path.includes(parent) || !(parent in m.profiles)) continue;
    const found = findCycle(m, start, [...path, parent]);
    if (found) return found;
  }
  return null;
}

/**
 * 프로필을 extends 까지 풀어 카테고리 → id 목록으로. 부모 것이 앞, 자기 것이 뒤, 중복은 한 번.
 * instructions 는 순서가 의미이므로(§3.3) 부모 조각이 먼저 import 된다. 빼기는 없다 — 덜 원하면 상속하지 말고 나열한다.
 */
export function resolveProfile(m: Manifest, profile: string, seen: string[] = []): Profile {
  const p = m.profiles[profile];
  if (!p) {
    const names = Object.keys(m.profiles);
    throw new Error(`프로필 "${profile}" 이 없습니다. 있는 프로필: ${names.length ? names.join(", ") : "(없음)"}`);
  }
  if (seen.includes(profile)) throw new ManifestError(`profiles.${profile}.extends: 순환 상속 (${[...seen, profile].join(" → ")})`);
  const out: Record<string, string[]> = {};
  const push = (cat: string, ids: string[]) => {
    const list = (out[cat] ??= []);
    for (const id of ids) if (!list.includes(id)) list.push(id);
  };
  for (const parent of p[EXTENDS] ?? []) {
    for (const [cat, ids] of Object.entries(resolveProfile(m, parent, [...seen, profile]))) push(cat, ids);
  }
  for (const [cat, ids] of Object.entries(p)) if (cat !== EXTENDS) push(cat, ids);
  return out;
}

/** 프로필이 요구하는 패키지 목록 (상속 포함) */
export function packagesOf(m: Manifest, profile: string): Package[] {
  const ids = resolveProfile(m, profile)[PACKAGES] ?? [];
  return ids.map((id) => m.packages.find((p) => p.id === id)!);
}

/** 어떤 프로필에도 쓰이지 않는 부품 (list --unused, prune 의 근거). */
export function unusedComponents(m: Manifest): { category: string; id: string }[] {
  const used = new Set<string>();
  for (const cats of Object.values(m.profiles)) {
    for (const [cat, ids] of Object.entries(cats)) if (cat !== EXTENDS) for (const id of ids) used.add(`${cat}/${id}`);
  }
  const out: { category: string; id: string }[] = [];
  for (const [cat, comps] of Object.entries(m.components)) {
    for (const c of comps) if (!used.has(`${cat}/${c.id}`)) out.push({ category: cat, id: c.id });
  }
  return out;
}
