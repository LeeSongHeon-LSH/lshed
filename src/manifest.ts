import { z } from "zod";
import YAML from "yaml";
import { parseSource } from "./source.js";

/** 부품 하나. source 생략 시 file:./<category>/<id> (§3.2 관례). */
const ComponentSchema = z.object({
  id: z.string().regex(/^[\w.-]+$/, "id는 영문·숫자·._- 만 허용"),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type Component = z.infer<typeof ComponentSchema>;

/** 카테고리 이름은 어댑터가 정한다. 스키마는 이름을 고정하지 않는다 (§4.1). */
const ComponentsSchema = z.record(z.string(), z.array(ComponentSchema));
const ProfileSchema = z.record(z.string(), z.array(z.string()));

export const ManifestSchema = z.object({
  version: z.literal(1),
  agent: z.string().default("claude-code"),
  components: ComponentsSchema.default({}),
  profiles: z.record(z.string(), ProfileSchema).default({}),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export class ManifestError extends Error {}

/** YAML 문자열 → 검증된 매니페스트. 참조 무결성까지 확인한다. */
export function parseManifest(text: string, knownCategories?: readonly string[]): Manifest {
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
        parseSource(effectiveSource(cat, c));
      } catch (e) {
        problems.push(`${cat}/${c.id}: ${(e as Error).message}`);
      }
    }
  }

  for (const [profile, cats] of Object.entries(m.profiles)) {
    for (const [cat, ids] of Object.entries(cats)) {
      const available = new Set((m.components[cat] ?? []).map((c) => c.id));
      for (const id of ids) {
        if (!available.has(id)) problems.push(`profiles.${profile}.${cat}: "${id}" 는 components에 없음`);
      }
    }
  }

  if (problems.length) throw new ManifestError(`lshed.yaml 참조 오류:\n${problems.map((p) => "  " + p).join("\n")}`);
  return m;
}

/** source 생략 시 관례: file:./<category>/<id> (dir) 또는 file:./<category>/<id>.md (file) */
export function effectiveSource(category: string, c: Component, kind: "dir" | "file" = "dir"): string {
  return c.source ?? `file:./${category}/${c.id}${kind === "file" ? ".md" : ""}`;
}

export function stringifyManifest(m: Manifest): string {
  return YAML.stringify(m, { lineWidth: 0 });
}

/** 어떤 프로필에도 쓰이지 않는 부품 (list --unused, prune 의 근거). */
export function unusedComponents(m: Manifest): { category: string; id: string }[] {
  const used = new Set<string>();
  for (const cats of Object.values(m.profiles)) {
    for (const [cat, ids] of Object.entries(cats)) for (const id of ids) used.add(`${cat}/${id}`);
  }
  const out: { category: string; id: string }[] = [];
  for (const [cat, comps] of Object.entries(m.components)) {
    for (const c of comps) if (!used.has(`${cat}/${c.id}`)) out.push({ category: cat, id: c.id });
  }
  return out;
}
