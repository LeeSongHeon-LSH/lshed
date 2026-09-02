# Changelog

## 0.1.1 — 2026-09-02

Both fixes came from running 0.1.0 against a real 62-skill `~/.claude`.

- Skip regenerable directories when copying: `node_modules`, `.git`, `__pycache__`, `.venv`, cache dirs, `*.log`. A real harness went from 1.6 GB to 6.2 MB. Build output such as `dist/` is **not** ignored by default, because for some skills it is the deliverable.
- Extend the list with `ignore:` in `lshed.yaml`; the same list applies to `diff`, `save` and backups, so ignored files never show up as drift.
- Follow symlinks. A skill symlinked into `~/.claude/skills` used to be skipped silently; it is now captured and copied by content. Broken links are skipped.
- `init --exclude <id...>` leaves out components that do not belong in a shed, such as a toolkit with its own installer.

## 0.1.0 — 2026-09-02

First working release. Claude Code only.

- `init` scans `~/.claude` (skills, agents, commands, CLAUDE.md) into a shed and writes `lshed.yaml`
- `restore <profile>` with managed-set semantics, backups on by default, `--dry-run`
- `status`, `diff`, `save`
- Instructions are assembled as an `@`-import list, not merged
- `file:` sources only; `github:` is parsed but rejected until 0.2
