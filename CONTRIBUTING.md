# Contributing

## Development

Node 20 or newer. Runtime dependencies are none: everything (`commander`, `yaml`, `zod`, `@clack/prompts`, `smol-toml`) is a dev dependency bundled into `dist/cli.js` by tsup.

```
npm ci
npm run dev -- status        # run src/cli.ts through tsx, no build
npm run typecheck            # tsc --noEmit
npm test                     # vitest run
npm run build                # tsup → dist/cli.js
npm run smoke                # scripts/smoke.mjs: the whole walk against dist/cli.js in a scratch HOME
npm run binaries             # scripts/build-binaries.mjs: five standalone binaries into build/ (needs bun)
```

`LSHED_CLI=<path> npm run smoke` runs the smoke suite against another executable, for example a compiled binary (`LSHED_CLI=build/lshed-linux-x64`).

CI (`.github/workflows/ci.yml`) runs typecheck, tests, build and smoke on Ubuntu, macOS and Windows with Node 20 and 22 on every push. A new feature needs to pass there on all three. The probe against the real agent CLIs is in `scripts/vm/` (runbook: `scripts/vm/README.md`) and runs weekly in `.github/workflows/probe.yml`.

## Releasing

1. Bump `version` in `package.json`, move the `## Unreleased` notes in `CHANGELOG.md` under the new version with the date, commit.
2. Tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`. The `release` workflow (`.github/workflows/release.yml`) builds the five binaries on Ubuntu, runs the smoke suite against `lshed-linux-x64`, writes `SHA256SUMS.txt` and publishes a GitHub release with them.
3. Publish to npm by hand: `npm publish` (asks for the OTP). `prepublishOnly` runs typecheck, tests and build first.
