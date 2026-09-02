import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_IGNORE, isIgnored } from "./ignore.js";

export async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function isDir(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

export type Ignore = readonly string[];

/**
 * 파일이면 [""], 디렉터리면 정렬된 상대 경로 목록 (POSIX 구분자).
 * 심볼릭 링크는 따라간다. 무시 패턴에 걸리는 구간은 내려가지 않는다.
 */
export async function listFiles(root: string, ignore: Ignore = DEFAULT_IGNORE): Promise<string[]> {
  if (!(await exists(root))) return [];
  if (!(await isDir(root))) return [""];
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (isIgnored(r, ignore)) continue;
      const full = path.join(dir, e.name);
      // 링크일 수 있으므로 stat 으로 판정한다 (Dirent 는 링크를 파일/디렉터리로 보지 않는다)
      let st;
      try { st = await fs.stat(full); } catch { continue; }  // 끊어진 링크는 건너뛴다
      if (st.isDirectory()) await walk(full, r);
      else if (st.isFile()) out.push(r);
    }
  }
  await walk(root, "");
  return out.sort();
}

export async function hashFile(p: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(p)).digest("hex");
}

/** 파일 또는 디렉터리 트리의 내용 해시. 없으면 null. */
export async function hashTree(root: string, ignore: Ignore = DEFAULT_IGNORE): Promise<string | null> {
  if (!(await exists(root))) return null;
  const h = createHash("sha256");
  for (const rel of await listFiles(root, ignore)) {
    h.update(rel).update("\0").update(await fs.readFile(rel ? path.join(root, rel) : root)).update("\0");
  }
  return h.digest("hex");
}

/**
 * src(파일/디렉터리) → dst 로 복사. dst가 있으면 먼저 지운다.
 * 심볼릭 링크는 실제 내용으로 복사한다(dereference). 무시 패턴은 제외한다.
 */
export async function copyTree(src: string, dst: string, ignore: Ignore = DEFAULT_IGNORE): Promise<void> {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  const srcRoot = path.resolve(src);
  await fs.cp(src, dst, {
    recursive: true,
    dereference: true,
    filter: (from) => {
      const rel = path.relative(srcRoot, path.resolve(from)).split(path.sep).join("/");
      return !isIgnored(rel, ignore);
    },
  });
}

export async function removeTree(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

export type FileChange = { status: "A" | "M" | "D"; file: string };

/** local 대비 shed: 파일 단위 변경 목록. local에만 있으면 A, 다르면 M, shed에만 있으면 D. */
export async function diffTrees(local: string, shed: string, ignore: Ignore = DEFAULT_IGNORE): Promise<FileChange[]> {
  const l = new Set(await listFiles(local, ignore));
  const s = new Set(await listFiles(shed, ignore));
  const out: FileChange[] = [];
  for (const f of [...new Set([...l, ...s])].sort()) {
    const lp = f ? path.join(local, f) : local;
    const sp = f ? path.join(shed, f) : shed;
    if (l.has(f) && !s.has(f)) out.push({ status: "A", file: f });
    else if (!l.has(f) && s.has(f)) out.push({ status: "D", file: f });
    else if ((await hashFile(lp)) !== (await hashFile(sp))) out.push({ status: "M", file: f });
  }
  return out;
}
