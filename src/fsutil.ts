import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

export async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

export async function isDir(p: string): Promise<boolean> {
  try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
}

/** 파일이면 [""], 디렉터리면 정렬된 상대 경로 목록 (POSIX 구분자). */
export async function listFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];
  if (!(await isDir(root))) return [""];
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  }
  await walk(root, "");
  return out.sort();
}

export async function hashFile(p: string): Promise<string> {
  return createHash("sha256").update(await fs.readFile(p)).digest("hex");
}

/** 파일 또는 디렉터리 트리의 내용 해시. 없으면 null. */
export async function hashTree(root: string): Promise<string | null> {
  if (!(await exists(root))) return null;
  const h = createHash("sha256");
  for (const rel of await listFiles(root)) {
    h.update(rel).update("\0").update(await fs.readFile(rel ? path.join(root, rel) : root)).update("\0");
  }
  return h.digest("hex");
}

/** src(파일/디렉터리) → dst 로 복사. dst가 있으면 먼저 지운다. */
export async function copyTree(src: string, dst: string): Promise<void> {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.cp(src, dst, { recursive: true });
}

export async function removeTree(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

export type FileChange = { status: "A" | "M" | "D"; file: string };

/** local 대비 shed: 파일 단위 변경 목록. local에만 있으면 A, 다르면 M, shed에만 있으면 D. */
export async function diffTrees(local: string, shed: string): Promise<FileChange[]> {
  const l = new Set(await listFiles(local));
  const s = new Set(await listFiles(shed));
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
