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
  it("모르는 스킴은 other 로 통과시키고 설치기가 판단한다", () => {
    expect(parseSource("claude-plugin:exa@official")).toEqual({ scheme: "other", name: "claude-plugin", rest: "exa@official" });
    expect(formatSource(parseSource("claude-plugin:exa@official"))).toBe("claude-plugin:exa@official");
    expect(() => parseSource("Bad Scheme:x")).toThrow(/알 수 없는 스킴/);
  });
  it("round-trip", () => {
    for (const s of ["file:./a", "github:a/b", "github:a/b@v1", "github:a/b@v1#c/d"]) {
      expect(formatSource(parseSource(s))).toBe(s);
    }
  });
});

describe("git: 스킴과 원격 URL 변환", () => {
  it("git: URL#ref", () => {
    expect(parseSource("git:https://gitlab.com/a/b.git#main")).toEqual({ scheme: "git", url: "https://gitlab.com/a/b.git", ref: "main" });
    expect(parseSource("git:file:///tmp/repo")).toEqual({ scheme: "git", url: "file:///tmp/repo", ref: undefined });
    expect(formatSource(parseSource("git:ssh://x/y#v1"))).toBe("git:ssh://x/y#v1");
  });
  it("GitHub 원격은 github: 로 줄인다", async () => {
    const { sourceFromRemote, cloneTarget } = await import("../src/source.js");
    expect(sourceFromRemote("https://github.com/garrytan/gstack.git", "main")).toBe("github:garrytan/gstack@main");
    expect(sourceFromRemote("git@github.com:garrytan/gstack.git")).toBe("github:garrytan/gstack");
    expect(sourceFromRemote("https://gitlab.com/a/b.git", "dev")).toBe("git:https://gitlab.com/a/b.git#dev");
    expect(cloneTarget(parseSource("github:a/b@v1"))).toEqual({ url: "https://github.com/a/b.git", ref: "v1" });
    expect(() => cloneTarget(parseSource("file:./x"))).toThrow();
  });
});
