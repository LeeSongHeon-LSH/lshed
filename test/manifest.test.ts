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
