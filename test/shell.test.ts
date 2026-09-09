import { describe, it, expect } from "vitest";
import { commandLine } from "../src/shell.js";

// Windows 에서 .cmd 래퍼를 셸로 부를 때 쓰는 한 줄. args 배열 + shell:true 는 Node 24 가 DEP0190 을 찍는다.
describe("commandLine", () => {
  it("공백·따옴표가 없는 인자는 그대로 잇는다", () => {
    expect(commandLine("claude", ["plugin", "install", "exa@claude-plugins-official", "-y"])).toBe("claude plugin install exa@claude-plugins-official -y");
  });
  it("공백이 든 인자는 큰따옴표로 감싼다 (check 의 프롬프트)", () => {
    expect(commandLine("claude", ["-p", "reply with the passphrase"])).toBe('claude -p "reply with the passphrase"');
  });
  it("안쪽 큰따옴표는 \\\" 로, 빈 인자는 \"\" 로", () => {
    expect(commandLine("x", ['say "hi"', ""])).toBe('x "say \\"hi\\"" ""');
  });
  it("따옴표 앞의 역슬래시는 두 배로 (CreateProcess 규칙)", () => {
    expect(commandLine("x", ['C:\\my dir\\', 'a\\"b'])).toBe('x "C:\\my dir\\\\" "a\\\\\\"b"');
  });
});
