import { Command } from "commander";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { ClaudeCodeAdapter } from "./adapters/claude-code.js";
import type { Ctx } from "./core/context.js";
import { init } from "./core/init.js";
import { restore } from "./core/restore.js";
import { status, formatStatus } from "./core/status.js";
import { diff, formatDiff } from "./core/diff.js";
import { save } from "./core/save.js";
import { readState } from "./state.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

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
  return { adapter, shed: path.resolve(shed), log: (l) => console.log(l) };
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
  .action((o: { profile: string }) => run(async () => {
    const ctx = await ctxFor("init");
    console.log(`스캔: ${ctx.adapter.root}  →  창고: ${ctx.shed}`);
    await init(ctx, { profile: o.profile });
    console.log(`\n다음: 창고를 git 으로 관리하세요.  cd ${ctx.shed} && git init`);
  }));

program
  .command("restore [profile]")
  .description("apply a profile (defaults to the last applied one)")
  .option("--dry-run", "print what would change without touching anything")
  .option("--no-backup", "skip backing up files that get replaced or removed")
  .action((profile: string | undefined, o: { dryRun?: boolean; backup: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    await restore(ctx, profile, { dryRun: o.dryRun, backup: o.backup });
  }));

program
  .command("status")
  .description("show the applied profile, managed paths and drift")
  .action(() => run(async () => {
    const adapter = adapterFromOpts();
    const state = await readState(adapter);
    if (!state) { console.log(formatStatus({ state: null, drifted: [] }, adapter.root)); return; }
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
  .command("scan")
  .description("(debug) list components found in the agent config root")
  .action(() => run(async () => {
    const adapter = adapterFromOpts();
    const found = await adapter.scan();
    for (const c of found) console.log(`${c.category}/${c.id}\t${c.path}`);
    console.error(`${found.length}개 발견 (root: ${adapter.root})`);
  }));

program.parseAsync();
