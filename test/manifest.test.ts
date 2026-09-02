import { describe, it, expect } from "vitest";
import { parseManifest, unusedComponents, effectiveSource, stringifyManifest } from "../src/manifest.js";

const GOOD = `
version: 1
agent: claude-code
components:
  skills:
    - id: paper-review
    - id: superpowers
      source: github:obra/superpowers@v2.1
  instructions:
    - id: base
      source: file:./instructions/base.md
profiles:
  research:
    skills: [paper-review, superpowers]
    instructions: [base]
  teaching:
    skills: [paper-review]
`;

describe("parseManifest", () => {
  it("정상 매니페스트", () => {
    const m = parseManifest(GOOD);
    expect(Object.keys(m.profiles)).toEqual(["research", "teaching"]);
    expect(effectiveSource("skills", m.components.skills[0])).toBe("file:./skills/paper-review");
  });
  it("version 불일치", () => {
    expect(() => parseManifest("version: 2\n")).toThrow(/형식 오류/);
  });
  it("프로필이 없는 부품을 참조", () => {
    expect(() => parseManifest(GOOD + "  x:\n    skills: [nope]\n")).toThrow(/"nope" 는 components에 없음/);
  });
  it("id 중복", () => {
    const dup = GOOD.replace("- id: superpowers\n      source: github:obra/superpowers@v2.1", "- id: paper-review");
    expect(() => parseManifest(dup)).toThrow(/중복/);
  });
  it("스킴 없는 source 거부", () => {
    expect(() => parseManifest(GOOD.replace("file:./instructions/base.md", "./instructions/base.md"))).toThrow(/스킴/);
  });
  it("어댑터가 모르는 카테고리 거부", () => {
    expect(() => parseManifest(GOOD, ["skills"])).toThrow(/알 수 없는 카테고리 "instructions"/);
  });
  it("미사용 부품 탐지", () => {
    const m = parseManifest(GOOD + "  # unused\ncomponents2: 0\n".replace("components2: 0\n", ""));
    expect(unusedComponents(m)).toEqual([]);
    const m2 = parseManifest(GOOD.replace("skills: [paper-review, superpowers]", "skills: [paper-review]"));
    expect(unusedComponents(m2)).toEqual([{ category: "skills", id: "superpowers" }]);
  });
  it("stringify → parse 왕복", () => {
    const m = parseManifest(GOOD);
    expect(parseManifest(stringifyManifest(m))).toEqual(m);
  });
});

describe("ignore", () => {
  it("경로의 어느 구간이든 걸리면 무시", async () => {
    const { isIgnored, DEFAULT_IGNORE } = await import("../src/ignore.js");
    expect(isIgnored("node_modules/x/y.js", DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored("a/.git/config", DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored("a/b.log", DEFAULT_IGNORE)).toBe(true);
    expect(isIgnored("src/index.ts", DEFAULT_IGNORE)).toBe(false);
    expect(isIgnored("dist/bundle.js", DEFAULT_IGNORE)).toBe(false); // dist 는 기본 무시 대상이 아니다
    expect(isIgnored("dist/bundle.js", [...DEFAULT_IGNORE, "dist"])).toBe(true);
    expect(isIgnored("", DEFAULT_IGNORE)).toBe(false);
  });
  it("매니페스트의 ignore 는 선택 항목", () => {
    const m = parseManifest("version: 1\nignore: [dist]\n");
    expect(m.ignore).toEqual(["dist"]);
  });
});

describe("packages", () => {
  const P = `
version: 1
packages:
  - id: gstack
    source: github:garrytan/gstack@main
    into: skills/gstack
    install: ./setup
profiles:
  default:
    packages: [gstack]
`;
  it("정상", () => {
    const m = parseManifest(P);
    expect(m.packages[0].install).toBe("./setup");
    expect(m.profiles.default.packages).toEqual(["gstack"]);
  });
  it("file: 출처는 패키지가 될 수 없다", () => {
    expect(() => parseManifest(P.replace("github:garrytan/gstack@main", "file:./x"))).toThrow(/file: 일 수 없습니다/);
  });
  it("github: 패키지는 into 가 필요하고, 부품은 어댑터 스킴을 쓸 수 없다", () => {
    expect(() => parseManifest(P.replace("    into: skills/gstack\n", ""))).toThrow(/into 가 필요/);
    expect(() => parseManifest("version: 1\ncomponents:\n  skills:\n    - id: x\n      source: claude-plugin:x@m\n")).toThrow(/부품 출처는 file:/);
  });
  it("설치기가 없는 스킴은 거부", () => {
    expect(() => parseManifest(P.replace("github:garrytan/gstack@main", "registry:foo"), undefined, ["github", "git"])).toThrow(/설치기가 없습니다/);
  });
  it("프로필이 없는 패키지를 참조", () => {
    expect(() => parseManifest(P.replace("packages: [gstack]", "packages: [nope]"))).toThrow(/"nope" 는 packages 에 없음/);
  });
  it("packages 는 어댑터 카테고리 검사에 걸리지 않는다", () => {
    expect(() => parseManifest(P, ["skills"])).not.toThrow();
  });
});
