import { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { createAdapter, adapterNames, DEFAULT_AGENT } from "./adapters/registry.js";
import type { AgentAdapter } from "./adapters/types.js";
import { spawnExec, manifestAgent, installablePackages, schemeOf, MANIFEST_FILE, type Ctx } from "./core/context.js";
import { init } from "./core/init.js";
import { restore } from "./core/restore.js";
import { pick, type Prompter } from "./core/pick.js";
import * as clack from "@clack/prompts";
import { status, formatStatus } from "./core/status.js";
import { diff, formatDiff } from "./core/diff.js";
import { save } from "./core/save.js";
import { readState } from "./state.js";
import { loadManifest } from "./core/context.js";
import { updatePackages, reportPending } from "./core/packages.js";
import { listRows, formatRows } from "./core/list.js";
import { remove, prune } from "./core/remove.js";
import { add } from "./core/add.js";
import { sync } from "./core/sync.js";
import { collectReport, formatReport, issueUrl, openUrl, ISSUES_URL } from "./core/report.js";

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
  .option("--agent <name>", `which agent to place into: ${adapterNames().join(", ")} (default: $LSHED_AGENT, then the shed's agent, then ${DEFAULT_AGENT})`)
  .option("--root <dir>", "agent config root (default: the agent's own, e.g. ~/.claude or ~/.codex)");

/**
 * 어댑터 선택: --agent > $LSHED_AGENT > (창고 위치를 알면) lshed.yaml 의 agent > claude-code.
 * 창고 위치를 state 에서 가져오는 경우는 어댑터가 먼저 필요하므로 매니페스트를 볼 수 없다 — 그때는 기본값이다.
 */
async function adapterFromOpts(): Promise<AgentAdapter> {
  const { root, agent, shed } = program.opts<{ root?: string; agent?: string; shed?: string }>();
  let name = agent ?? process.env.LSHED_AGENT;
  const shedDir = shed ?? process.env.LSHED_HOME;
  if (!name && shedDir) {
    try { name = manifestAgent(await fs.readFile(path.join(path.resolve(shedDir), MANIFEST_FILE), "utf8")); } catch { /* 창고가 아직 없음 (init) */ }
  }
  return createAdapter(name ?? DEFAULT_AGENT, root ? path.resolve(root) : undefined);
}

async function ctxFor(cmd: "init" | "other"): Promise<Ctx> {
  const adapter = await adapterFromOpts();
  const { shed: flag } = program.opts<{ shed?: string }>();
  let shed = flag ?? process.env.LSHED_HOME;
  if (!shed && cmd === "other") shed = (await readState(adapter))?.shed;
  if (!shed && cmd === "init") shed = path.join(os.homedir(), "lshed");
  if (!shed) throw new Error("Shed location unknown. Pass --shed <dir> or set LSHED_HOME.");
  return { adapter, shed: path.resolve(shed), log: (l) => console.log(l), exec: spawnExec };
}

async function run(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const message = (e as Error).message;
    console.error(`error: ${message}`);
    process.exitCode = 1;
    await offerReport(message);
  }
}

/** 이 실행이 `lshed report` 자체이면 실패해도 다시 묻지 않는다. */
let reporting = false;

/**
 * 실패한 뒤에 한 번 묻는다: 이 설정의 요약(값 없음, 홈은 ~)을 채운 GitHub 이슈를 열까.
 * 터미널이 아니거나 LSHED_REPORT=0 이면 묻지 않고 한 줄만 남긴다. 어느 쪽이든 lshed 가 어딘가로 보내는 것은 없다 — 브라우저를 열 뿐이다.
 */
async function offerReport(error: string): Promise<void> {
  if (reporting || process.env.LSHED_REPORT === "0") return;
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) { console.error(`  (lshed report prints a summary you can paste into ${ISSUES_URL})`); return; }
  const yes = await clack.confirm({ message: "Open a bug report on GitHub with a summary of this setup? (no values or secrets; nothing is sent until you submit it)", initialValue: false });
  if (yes !== true) return;
  reporting = true;
  const r = await collectReport({ version, adapter: await adapterFromOpts(), shed: await shedIfKnown(), command: `lshed ${process.argv.slice(2).join(" ")}`, error });
  const url = issueUrl(r);
  console.error(`\n${formatReport(r)}\n\nOpening ${url.split("&report=")[0]}\n(if the browser does not open, paste the summary above into a new issue there)`);
  openUrl(url);
}

/** report 용: 창고 위치를 알면 주고, 모르면 undefined. ctxFor 와 달리 던지지 않는다. */
async function shedIfKnown(): Promise<string | undefined> {
  const { shed } = program.opts<{ shed?: string }>();
  const fromFlag = shed ?? process.env.LSHED_HOME;
  if (fromFlag) return path.resolve(fromFlag);
  try { return (await readState(await adapterFromOpts()))?.shed; } catch { return undefined; }
}

program
  .command("init")
  .description("scan the current environment into a shed and write lshed.yaml")
  .option("--profile <name>", "name of the initial profile", "default")
  .option("--exclude <id...>", "components to leave out (id or category/id)")
  .action((o: { profile: string; exclude?: string[] }) => run(async () => {
    const ctx = await ctxFor("init");
    console.log(`scan: ${ctx.adapter.root}  →  shed: ${ctx.shed}`);
    await init(ctx, { profile: o.profile, exclude: o.exclude });
    console.log(`\nNext: put the shed under git.  cd ${ctx.shed} && git init`);
  }));

/** 터미널 프롬프트. 취소(Ctrl+C)는 undefined 로 돌려서 pick 이 조용히 물러나게 한다. */
function terminalPrompter(): Prompter {
  const un = <T>(v: T | symbol): T | undefined => (clack.isCancel(v) ? undefined : (v as T));
  return {
    async multiselect(g) {
      return un(await clack.multiselect<string>({
        message: `${g.title}  — pick what this machine gets (space to toggle, a for all, enter for next)`,
        options: g.options.map((o) => ({ value: o.id, label: o.id, hint: o.hint })),
        initialValues: g.options.filter((o) => o.checked).map((o) => o.id),
        required: false,
      }));
    },
    async text(message, defaultValue, validate) {
      return un(await clack.text({ message, placeholder: defaultValue, defaultValue, validate: (v) => validate(v ?? "") }));
    },
    async confirm(message) {
      return un(await clack.confirm({ message }));
    },
  };
}

program
  .command("restore [profile]")
  .description("apply a profile (defaults to the last applied one; with no profile at all, opens the picker)")
  .option("--pick", "choose parts category by category and save the choice as a profile ([profile] pre-checks that profile)")
  .option("--link", "place file parts as links into the shed instead of copies (edits land in the shed; remembered for later restores)")
  .option("--no-link", "go back to copies on a machine that used --link")
  .option("--dry-run", "print what would change without touching anything")
  .option("--no-backup", "skip backing up files that get replaced or removed")
  .option("--yes", "run package install commands (they are shown, not run, without this)")
  .action((profile: string | undefined, o: { pick?: boolean; link?: boolean; dryRun?: boolean; backup: boolean; yes?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const firstTime = !profile && !(await readState(ctx.adapter));
    if (o.pick || (firstTime && tty)) {
      if (!tty) throw new Error("--pick needs an interactive terminal. Name the profile instead: lshed restore <profile>");
      if (firstTime && !o.pick) console.log("No profile applied yet, so opening the picker. To apply one directly: lshed restore <profile>\n");
      await pick(ctx, terminalPrompter(), { base: profile, dryRun: o.dryRun, backup: o.backup, yes: o.yes, link: o.link });
      return;
    }
    await restore(ctx, profile, { dryRun: o.dryRun, backup: o.backup, yes: o.yes, link: o.link });
  }));

program
  .command("update [ids...]")
  .description("pull packages to their latest upstream and refresh lshed.lock")
  .option("--dry-run", "ask upstream what would change, without touching anything")
  .option("--yes", "run package install commands after updating")
  .action((ids: string[], o: { dryRun?: boolean; yes?: boolean }) => run(async () => {
    const ctx = await ctxFor("other");
    const state = await readState(ctx.adapter);
    if (!state) throw new Error("No profile applied. Run 'lshed restore <profile>' first.");
    const m = await loadManifest(ctx);
    const pk = installablePackages(ctx, m, state.profile);
    for (const p of pk.skipped) console.log(`  · package ${p.id}  (${schemeOf(p.source)}: cannot be handled by ${ctx.adapter.name}, skipped)`);
    let pkgs = pk.packages;
    if (ids.length) {
      pkgs = ids.map((id) => {
        const p = m.packages.find((x) => x.id === id);
        if (!p) throw new Error(`no package "${id}"`);
        return p;
      });
    }
    if (!pkgs.length) { console.log("No packages to update."); return; }
    const res = await updatePackages(ctx, pkgs, { dryRun: o.dryRun, yes: o.yes });
    reportPending(ctx, res);
  }));

program
  .command("status")
  .description("show the applied profile, managed paths and drift")
  .action(() => run(async () => {
    const adapter = await adapterFromOpts();
    const state = await readState(adapter);
    if (!state) { console.log(formatStatus({ state: null, drifted: [], packages: [], missingEnv: [], fresh: [] }, adapter.root, adapter.name)); return; }
    const ctx = await ctxFor("other");
    console.log(formatStatus(await status(ctx), adapter.root, adapter.name));
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
    console.log(o.unused && !rows.length ? "Nothing unused." : formatRows(rows, m));
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
  .command("report")
  .description("print a summary of this setup (versions, agent, profile, shed contents by name; no values) to paste into a bug report")
  .option("--open", "also open a GitHub issue form with the summary filled in")
  .action((o: { open?: boolean }) => run(async () => {
    reporting = true;
    const r = await collectReport({ version, adapter: await adapterFromOpts(), shed: await shedIfKnown() });
    console.log(formatReport(r));
    if (o.open) { const url = issueUrl(r); console.error(`\nOpening ${url.split("&report=")[0]}`); openUrl(url); }
    else console.error(`\nPaste this into ${ISSUES_URL}/new/choose  (or: lshed report --open)`);
  }));

program
  .command("scan")
  .description("(debug) list components found in the agent config root")
  .action(() => run(async () => {
    const adapter = await adapterFromOpts();
    const found = await adapter.scan();
    for (const c of found) console.log(`${c.category}/${c.id}\t${c.path}`);
    let n = found.length;
    for (const e of adapter.entries()) for (const id of Object.keys(await e.read())) { console.log(`${e.name}/${id}\t(entry)`); n++; }
    console.error(`${n} found (root: ${adapter.root})`);
  }));

program.parseAsync();
