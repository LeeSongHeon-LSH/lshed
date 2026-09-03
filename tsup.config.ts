import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // 의존성을 번들에 넣는다. 설치가 가볍고, 단일 실행파일로 컴파일하기도 쉽다.
  noExternal: [/.*/],
  minify: true,
  // 번들된 CJS 의존성이 require 를 쓴다. ESM 출력에는 없으므로 만들어 준다.
  // 버전은 빌드 시점에 박는다 — 실행파일 안에서는 package.json 을 찾을 수 없다.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __lshedRequire } from "node:module";',
      "const require = __lshedRequire(import.meta.url);",
    ].join("\n"),
  },
  define: { __LSHED_VERSION__: JSON.stringify(version) },
});
