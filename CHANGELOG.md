# Changelog

## 0.1.0 — 2026-09-02

First working release. Claude Code only.

- `init` scans `~/.claude` (skills, agents, commands, CLAUDE.md) into a shed and writes `lshed.yaml`
- `restore <profile>` with managed-set semantics, backups on by default, `--dry-run`
- `status`, `diff`, `save`
- Instructions are assembled as an `@`-import list, not merged
- `file:` sources only; `github:` is parsed but rejected until 0.2
