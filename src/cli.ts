import { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import { spawnExec, type Ctx } from "./core/context.js";
import { init } from "./core/init.js";
import { restore } from "./core/restore.js";
import { status, formatStatus } from "./core/status.js";
import { diff, formatDiff } from "./core/diff.js";
import { save } from "./core/save.js";
import { readState } from "./state.js";
import { loadManifest } from "./core/context.js";
import { packagesOf } from "./manifest.js";
import { updatePackages, reportPending } from "./core/packages.js";
import { listRows, formatRows } from "./core/list.js";
import { remove, prune } from "./core/remove.js";
import { add } from "./core/add.js";
import { sync } from "./core/sync.js";

/** 빌드 시점에 tsup 이 박는다 (tsup.config.ts). 실행파일 안에는 package.json 이 없다. */
declare const __LSHED_VERSION__: string;
const version = typeof __LSHED_VERSION__ === "string" ? __LSHED_VERSION__ : "0.0.0-dev";

// `lshed status | head` 처럼 읽는 쪽이 먼저 닫으면 EPIPE 가 난다. 파이프의 정상적인 끝이므로 조용히 끝낸다.
for (const s of [process.stdout, process.stderr]) {
  s.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); });
}

const program = new Command()
  .name("lshed")
  .description("Keep your coding-agent harness (skills, agents, commands, instructions) in a shed and restore it anywhere by profile.")
  .version(version)
  .option("--shed <dir>", "shed directory (default: $LSHED_HOME, then the shed recorded by the last restore)")
  .option("--root <dir>", "agent config root (default: ~/.claude)");

function adapterFromOpts(): ClaudeCodeAdapter {
  const { root } = program.opts<{ root?: string }>();
  return new ClaudeCodeAdapter(root ? path.resolve(root) : undefined);
}

async function ctxFor(cmd: "init" | "other"): Promise<Ctx> {
  const adapter = adapterFromOpts();
  const { shed: flag } = program.opts<{ shed?: string }>();
  let shed = flag ?? process.env.LSHED_HOME;
  if (!shed && cmd === "other") shed = (await readState(adapter))?.shed;
  if (!shed && cmd === "init") shed = path.join(os.homedir(), "lshed");
  if (!shed) throw new Error("창고 위치를 모릅니다. --shed <dir> 또는 LSHED_HOME 을 지정하세요.");
  return { adapter, shed: path.resolve(shed), log: (l) => console.log(l), exec: spawnExec };
}

async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`오류: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

program
  .command("init")
  .description("scan the current environment into a shed and write lshed.yaml")
  .option("--profile <name>", "name of the initial profile", "default")
  .option("--exclude <id...>", "components to leave out (id or category/id)")
  .action((o: { profile: string; exclude?: string[] }) => run(async () => {
    const ctx = await ctxFor("init");
    console.log(`스캔: ${ctx.adapter.root}  →  창고: ${ctx.shed}`);
    await init(ctx, { profile: o.profile, exclude: o.exclude });
    console.log(`\n다음: 창고를 git 으로 관리하세요.  cd ${ctx.shed} && git init`);
  }));

program
  .command("restore [profile]")
  .description("apply a profile (defaults to the last applied one)")
  .option("--dry-run", "print what would change without touching anything")
  .option("--no-backup", "skip backing up files that get replaced or removed")
  .option("--yes", "run package install commands (they are shown, not run, without this)")
  .action((profile: string | undefined, o: { dryRun?: boolean; backup: boolean; yes?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    await restore(ctx, profile, { dryRun: o.dryRun, backup: o.backup, yes: o.yes });
  }));

program
  .command("update [ids...]")
  .description("pull packages to their latest upstream and refresh lshed.lock")
  .option("--dry-run", "show what would be updated")
  .option("--yes", "run package install commands after updating")
  .action((ids: string[], o: { dryRun?: boolean; yes?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    const state = await readState(ctx.adapter);
    if (!state) throw new Error("적용된 프로필이 없습니다. 먼저 'lshed restore <profile>' 을 실행하세요.");
    const m = await loadManifest(ctx);
    let pkgs = packagesOf(m, state.profile);
    if (ids.length) {
      pkgs = ids.map((id) => {
        const p = m.packages.find((x) => x.id === id);
        if (!p) throw new Error(`패키지 "${id}" 가 없습니다`);
        return p;
      });
    }
    if (!pkgs.length) { console.log("갱신할 패키지가 없습니다."); return; }
    const res = await updatePackages(ctx, pkgs, { dryRun: o.dryRun, yes: o.yes });
    reportPending(ctx, res);
  }));

program
  .command("status")
  .description("show the applied profile, managed paths and drift")
  .action(() => run(async () => {
    const adapter = adapterFromOpts();
    const state = await readState(adapter);
    if (!state) { console.log(formatStatus({ state: null, drifted: [], packages: [], missingEnv: [], fresh: [] }, adapter.root)); return; }
    const ctx = await ctxFor("other");
    console.log(formatStatus(await status(ctx), adapter.root));
  }));

program
  .command("diff")
  .description("list files that differ between the local harness and the shed")
  .action(() => run(async () => {
    const ctx = await ctxFor("other");
    console.log(formatDiff(await diff(ctx)));
  }));

program
  .command("save [ids...]")
  .description("copy local edits back into the shed (file: sources only)")
  .action((ids: string[]) => run(async () => {
    const ctx = await ctxFor("other");
    await save(ctx, ids);
  }));

program
  .command("add [keys...]")
  .description("put things that appeared locally since init into the shed and the current profile (lists candidates without keys)")
  .option("--all", "add every candidate")
  .action((keys: string[], o: { all?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    await add(ctx, keys, { all: o.all });
  }));

program
  .command("sync")
  .description("commit the shed, pull --rebase and push (the shed must be a git repo with origin)")
  .option("-m, --message <msg>", "commit message (default: names the changed parts)")
  .option("--no-push", "commit and pull only")
  .option("--dry-run", "show what would be committed and pushed")
  .action((o: { message?: string; push: boolean; dryRun?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    await sync(ctx, { message: o.message, push: o.push, dryRun: o.dryRun });
  }));

program
  .command("list")
  .description("everything in the shed and which profiles use it")
  .option("--unused", "only things no profile uses")
  .action((o: { unused?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    const m = await loadManifest(ctx);
    const rows = listRows(m).filter((r) => !o.unused || !r.usedBy.length);
    console.log(o.unused && !rows.length ? "미사용 항목이 없습니다." : formatRows(rows, m));
  }));

program
  .command("remove <key>")
  .description("delete a component or package from the shed (refused while a profile uses it)")
  .action((key: string) => run(async () => {
    const ctx = await ctxFor("other");
    await remove(ctx, key);
  }));

program
  .command("prune")
  .description("remove everything no profile uses")
  .option("--yes", "actually delete; without it, just list")
  .action((o: { yes?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    await prune(ctx, { yes: o.yes });
  }));

program
  .command("scan")
  .description("(debug) list components found in the agent config root")
  .action(() => run(async () => {
    const adapter = adapterFromOpts();
    const found = await adapter.scan();
    for (const c of found) console.log(`${c.category}/${c.id}\t${c.path}`);
    let n = found.length;
    for (const e of adapter.entries()) for (const id of Object.keys(await e.read())) { console.log(`${e.name}/${id}\t(entry)`); n++; }
    console.error(`${n}개 발견 (root: ${adapter.root})`);
  }));

program.parseAsync();
