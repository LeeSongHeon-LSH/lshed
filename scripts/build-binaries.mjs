// Node 없이 쓸 수 있는 단일 실행파일. bun 이 dist/cli.js 를 런타임과 함께 묶는다.
// 사용: npm run build && npm run binaries
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const TARGETS = [
  ["bun-windows-x64", "lshed-windows-x64.exe"],
  ["bun-linux-x64", "lshed-linux-x64"],
  ["bun-linux-arm64", "lshed-linux-arm64"],
  ["bun-darwin-arm64", "lshed-darwin-arm64"],
  ["bun-darwin-x64", "lshed-darwin-x64"],
];

if (!spawnSync("bun", ["--version"], { encoding: "utf8" }).stdout) {
  console.error("bun 이 필요합니다: https://bun.sh  (curl -fsSL https://bun.sh/install | bash)");
  process.exit(1);
}
await fs.mkdir("build", { recursive: true });
const only = process.argv[2];
for (const [target, out] of TARGETS) {
  // "win" 이 "darwin" 에 걸리지 않도록 OS 이름 구간으로 맞춘다
  if (only && !target.split("-")[1].startsWith(only)) continue;
  const file = path.join("build", out);
  const r = spawnSync("bun", ["build", "--compile", `--target=${target}`, "dist/cli.js", "--outfile", file], { stdio: "inherit" });
  if (r.status !== 0) { console.error(`✘ ${target}`); process.exit(1); }
  const { size } = await fs.stat(file);
  console.log(`✔ ${out}  ${(size / 1024 / 1024).toFixed(0)} MB`);
}
