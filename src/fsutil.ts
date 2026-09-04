import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { DEFAULT_IGNORE, isIgnored } from "./ignore.js";

/**
 * 경로 비교의 플랫폼 차이를 한 곳에 모은다 (§4.5).
 * Windows 의 realpath/readlink 는 `\\?\C:\...` 를 돌려주기도 하고, 대소문자를 가리지 않는다.
 */
export function normalizePath(p: string): string {
  const n = path.resolve(p.replace(/^\\\\\?\\/, ""));
  return process.platform === "win32" ? n.toLowerCase() : n;
}

/**
 * 없는 경로도 최대한 실제 경로로 만든다. 존재하는 가장 가까운 조상을 realpath 하고 나머지를 붙인다.
 * macOS 의 /var → /private/var 처럼, 끊어진 링크의 목적지를 성한 경로와 견주려면 필요하다.
 */
export async function realpathish(p: string): Promise<string> {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p); // 루트까지 갔는데도 없다
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** child 가 parent 자신이거나 그 아래인가 */
export function isInside(parent: string, child: string): boolean {
  const a = normalizePath(parent), b = normalizePath(child);
  return a === b || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

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
    filter: async (from) => {
      const rel = path.relative(srcRoot, path.resolve(from)).split(path.sep).join("/");
      if (isIgnored(rel, ignore)) return false;
      // 끊어진 심볼릭 링크는 건너뛴다 (dereference 가 ENOENT 로 터지지 않게)
      try {
        if ((await fs.lstat(from)).isSymbolicLink()) await fs.stat(from);
      } catch { return false; }
      return true;
    },
  });
}

/** 링크 자체만 지운다. fs.rm 은 링크를 따라가지 않으므로 창고로 가는 링크를 지워도 창고는 그대로다. */
export async function removeTree(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

/** 심볼릭 링크(또는 Windows junction)인가. 끊어진 링크도 true. */
export async function isLink(p: string): Promise<boolean> {
  try { return (await fs.lstat(p)).isSymbolicLink(); } catch { return false; }
}

/** dst 가 src 를 가리키는 링크인가 */
export async function isLinkTo(dst: string, src: string): Promise<boolean> {
  try {
    if (!(await fs.lstat(dst)).isSymbolicLink()) return false;
    return normalizePath(await fs.realpath(dst)) === normalizePath(await fs.realpath(src));
  } catch { return false; }
}

/**
 * src 를 가리키는 링크를 dst 에 만든다 (§3.6 --link). dst 가 있으면 먼저 지운다.
 * 디렉터리는 Windows 에서 junction 이라 권한이 필요 없다. 파일 링크는 Windows 에서 개발자 모드가 없으면 실패하므로
 * 그때는 복사로 폴백하고 "copy" 를 돌려준다. 복사된 부품은 여느 복사본처럼 diff/save 대상이다.
 */
export async function linkTree(src: string, dst: string, ignore: Ignore = DEFAULT_IGNORE): Promise<"link" | "copy"> {
  await fs.rm(dst, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dst), { recursive: true });
  const target = path.resolve(src);
  const dir = await isDir(target);
  try {
    await fs.symlink(target, dst, dir ? (process.platform === "win32" ? "junction" : "dir") : "file");
    return "link";
  } catch {
    await copyTree(src, dst, ignore);
    return "copy";
  }
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
