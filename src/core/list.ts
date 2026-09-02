import type { Manifest } from "../manifest.js";
import { PACKAGES } from "../manifest.js";

export interface Row { kind: "component" | "package"; category: string; id: string; usedBy: string[] }

/** 창고의 모든 부품·패키지와 각각을 쓰는 프로필 */
export function listRows(m: Manifest): Row[] {
  const usedBy = (cat: string, id: string) =>
    Object.entries(m.profiles).filter(([, cats]) => (cats[cat] ?? []).includes(id)).map(([name]) => name);
  const rows: Row[] = [];
  for (const [cat, comps] of Object.entries(m.components)) {
    for (const c of comps) rows.push({ kind: "component", category: cat, id: c.id, usedBy: usedBy(cat, c.id) });
  }
  for (const p of m.packages) rows.push({ kind: "package", category: PACKAGES, id: p.id, usedBy: usedBy(PACKAGES, p.id) });
  return rows;
}

export function formatRows(rows: Row[], m: Manifest): string {
  if (!rows.length) return "(비어 있음)";
  const w = Math.max(...rows.map((r) => `${r.category}/${r.id}`.length));
  const lines = rows.map((r) => {
    const key = `${r.category}/${r.id}`.padEnd(w);
    const use = r.usedBy.length ? r.usedBy.join(", ") : "(미사용)";
    return `${r.kind === "package" ? "≡" : " "} ${key}  ${use}`;
  });
  const unused = rows.filter((r) => !r.usedBy.length).length;
  lines.push("", `${rows.length}개, 프로필 ${Object.keys(m.profiles).length}개${unused ? `, 미사용 ${unused}개 → lshed prune` : ""}`);
  return lines.join("\n");
}
