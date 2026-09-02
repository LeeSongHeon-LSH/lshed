import { describe, it, expect } from "vitest";
import { parseSource, formatSource } from "../src/source.js";

describe("parseSource", () => {
  it("file:", () => {
    expect(parseSource("file:./skills/x")).toEqual({ scheme: "file", path: "./skills/x" });
  });
  it("github: 전체 형식", () => {
    expect(parseSource("github:obra/superpowers@v2.1#skills/a")).toEqual({
      scheme: "github", owner: "obra", repo: "superpowers", ref: "v2.1", subpath: "skills/a",
    });
  });
  it("github: ref 생략", () => {
    expect(parseSource("github:a/b")).toMatchObject({ owner: "a", repo: "b", ref: undefined });
  });
  it("스킴 없으면 거부 (§6.2)", () => {
    expect(() => parseSource("./skills/x")).toThrow(/스킴/);
  });
  it("알 수 없는 스킴 거부", () => {
    expect(() => parseSource("registry:foo")).toThrow(/알 수 없는 스킴/);
  });
  it("round-trip", () => {
    for (const s of ["file:./a", "github:a/b", "github:a/b@v1", "github:a/b@v1#c/d"]) {
      expect(formatSource(parseSource(s))).toBe(s);
    }
  });
});
