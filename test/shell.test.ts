import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { commandLine, invocation } from "../src/shell.js";

// Windows 에서 .cmd 래퍼를 셸로 부를 때 쓰는 한 줄. args 배열 + shell:true 는 Node 24 가 DEP0190 을 찍는다.
// 이 한 줄은 cmd.exe 와 실행 파일의 인자 파서를 잇달아 지나므로, 따옴표 짝이 양쪽에서 똑같이 맞아야 한다.
describe("commandLine", () => {
  it("두 파서 중 누구도 손대지 않는 인자는 그대로 잇는다", () => {
    expect(commandLine("claude", ["plugin", "install", "exa@claude-plugins-official", "-y"])).toBe("claude plugin install exa@claude-plugins-official -y");
  });
  it("공백이 든 인자는 큰따옴표로 감싼다 (check 의 프롬프트)", () => {
    expect(commandLine("claude", ["-p", "reply with the passphrase"])).toBe('claude -p "reply with the passphrase"');
  });
  it('안쪽 큰따옴표는 "" 로 적는다 — cmd.exe 는 \\" 를 모르고 거기서 따옴표가 닫힌 것으로 본다', () => {
    expect(commandLine("x", ['say "hi"', ""])).toBe('x "say ""hi""" ""');
  });
  it("따옴표 앞의 역슬래시는 두 배로 (CreateProcess 규칙)", () => {
    expect(commandLine("x", ["C:\\my dir\\", 'a\\"b'])).toBe('x "C:\\my dir\\\\" "a\\\\""b"');
  });

  // 0.17.2 의 구멍: 공백이 없으면 감싸지 않아 cmd.exe 가 메타문자를 연산자로 읽었다.
  it("공백이 없어도 cmd.exe 메타문자가 들었으면 감싼다", () => {
    for (const a of ["exa&calc.exe", "a|b", "a>b", "a<b", "a^b", "(x)", "%PATH%", "a!b"]) {
      expect(commandLine("x", [a])).toBe(`x "${a}"`);
    }
  });
  it("따옴표가 깨지지 않아 뒤따르는 & 가 살아나지 않는다", () => {
    // 옛 규칙은 'x "a\"b" "d & e"' 를 냈고, cmd 는 a\" 에서 따옴표가 닫혔다고 보아 & 를 명령 구분자로 읽었다
    const line = commandLine("x", ['a"b', "d & e"]);
    expect(line).toBe('x "a""b" "d & e"');
    // cmd 가 세는 따옴표 개수가 짝수여야 & 가 따옴표 안에 있다
    expect((line.match(/"/g) ?? []).length % 2).toBe(0);
  });
  it("줄바꿈은 따옴표 안에서도 명령을 끊으므로 거부한다", () => {
    expect(() => commandLine("x", ["a\nb"])).toThrow(/newline/);
    expect(() => commandLine("x", ["a\r\nb"])).toThrow(/newline/);
  });
});

describe("invocation", () => {
  it("win32 는 한 줄 + shell, args 는 비운다 (빈 배열은 DEP0190 을 찍지 않는다)", () => {
    expect(invocation("claude", ["-p", "two words"], "win32")).toEqual({ file: 'claude -p "two words"', args: [], shell: true });
  });
  it("그 밖의 OS 는 셸 없이 인자 배열 그대로", () => {
    expect(invocation("claude", ["-p", "two words"], "linux")).toEqual({ file: "claude", args: ["-p", "two words"], shell: false });
  });
});

// 실제로 자식 프로세스까지 인자가 온전히 가는지. Windows CI 에서는 cmd.exe 를 실제로 지난다 —
// 0.17.2 까지 win32 spawn 경로에는 e2e 시험이 하나도 없었다 (패키지 테스트는 exec 을 전부 가짜로 바꾼다).
describe("실제 자식 프로세스 왕복", () => {
  it("cmd.exe 를 지나도 인자가 그대로 도착한다", async () => {
    const args = ["plain", "has space", 'say "hi"', "a & b", "p|q", "(x)", "C:\\dir\\", "a^b", "exa@official"];
    const iv = invocation(process.execPath, ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...args]);
    const out = await new Promise<string>((resolve, reject) => {
      let o = "";
      const p = spawn(iv.file, iv.args, { shell: iv.shell, windowsHide: true, stdio: ["ignore", "pipe", "inherit"] });
      p.stdout.on("data", (d) => (o += d));
      p.on("error", reject);
      p.on("close", () => resolve(o));
    });
    expect(JSON.parse(out)).toEqual(args);
  });
});
