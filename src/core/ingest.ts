import path from "node:path";
import YAML, { isSeq, isMap, type Document } from "yaml";
import { type Ctx, targetRel, ignoreOf } from "./context.js";
import { copyTree } from "../fsutil.js";
import type { Lock } from "../lock.js";
import { mask, placeholdersIn, suspiciousStrings, writeEntryFile } from "./entries.js";
import { PACKAGES } from "../manifest.js";
import { type Found, shortRev } from "./discover.js";

export interface Ingested { managed: string[]; copied: number; packages: string[] }

/** 문서의 경로에 있는 목록을 얻거나 만든다 */
function seqAt(doc: Document, p: (string | number)[]): YAML.YAMLSeq {
  let node = doc.getIn(p);
  if (!isSeq(node)) { node = doc.createNode([]); doc.setIn(p, node); }
  return node as YAML.YAMLSeq;
}

function pushUnique(seq: YAML.YAMLSeq, value: string): void {
  if (!seq.items.some((it) => (isMap(it) ? it.get("id") : String(it)) === value)) seq.add(value);
}

/**
 * 발견한 것들을 창고에 넣고 매니페스트 문서를 고친다 (init 과 add 공용).
 *  - 부품: 복사. 항목: 마스킹해서 json 으로. 패키지: 출처만 + 락.
 *  - 프로필에 추가하고, 관리 집합에 넣을 rel 을 돌려준다 (패키지는 관리 집합 밖, §3.7).
 * 매니페스트 문서를 편집하는 방식이라 사용자의 주석이 남는다. 저장은 호출자가 한다.
 */
export async function ingest(ctx: Ctx, doc: Document, profile: string, items: Found[], lock: Lock): Promise<Ingested> {
  const out: Ingested = { managed: [], copied: 0, packages: [] };
  for (const f of items) {
    if (f.kind === "package") {
      const p = f.pkg;
      const node = doc.createNode(p.into ? { id: p.id, source: p.source, into: p.into } : { id: p.id, source: p.source }) as YAML.YAMLMap;
      // 설치 명령은 자동으로 알 수 없다. git 패키지에는 사용자가 채울 자리를 남긴다.
      if (p.into) node.comment = " install: ./setup    # ← 복원 후 실행할 명령이 있으면 채우세요 (--yes 로 실행)";
      const seq = seqAt(doc, [PACKAGES]);
      if (!seq.items.some((it) => isMap(it) && it.get("id") === p.id)) seq.add(node);
      pushUnique(seqAt(doc, ["profiles", profile, PACKAGES]), p.id);
      lock.packages[p.id] = { source: p.source, rev: p.rev };
      out.packages.push(p.id);
      ctx.log(`  ≡ package ${p.id}  ${p.source} @${shortRev(p.rev)}  (참조만 기록)`);
      continue;
    }
    if (f.kind === "component") {
      const dst = path.join(ctx.shed, f.cat.root, f.cat.kind === "dir" ? f.id : `${f.id}.md`);
      await copyTree(f.path, dst, ignoreOf(ctx));
      ctx.log(`  + ${f.category}/${f.id}`);
    } else {
      const masked = mask(f.id, f.value, f.cat);
      await writeEntryFile(path.join(ctx.shed, f.category, `${f.id}.json`), masked);
      const vars = placeholdersIn(masked);
      ctx.log(`  + ${f.category}/${f.id}${vars.length ? `  (시크릿 → ${vars.map((v) => "${" + v + "}").join(", ")})` : ""}`);
      for (const where of suspiciousStrings(masked)) ctx.log(`    ! ${where} 가 시크릿처럼 보입니다. 창고의 ${f.category}/${f.id}.json 에서 \${VAR} 로 바꾸세요`);
    }
    const comps = seqAt(doc, ["components", f.category]);
    if (!comps.items.some((it) => isMap(it) && it.get("id") === f.id)) comps.add(doc.createNode({ id: f.id }));
    pushUnique(seqAt(doc, ["profiles", profile, f.category]), f.id);
    out.managed.push(targetRel(f.cat, f.id));
    out.copied++;
  }
  return out;
}

/** 빈 목록·빈 맵은 쓰지 않는다. 사용자가 손으로 고치는 파일이라 잡음을 줄인다. */
export function tidy(doc: Document): void {
  const pk = doc.get(PACKAGES);
  if (isSeq(pk) && !pk.items.length) doc.delete(PACKAGES);
}
