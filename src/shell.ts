/**
 * Windows 에서 `claude.cmd` 같은 래퍼는 셸(cmd.exe)을 거쳐야 찾는다. Node 24 는 args 배열과 `shell: true` 를
 * 함께 주는 것을 폐기 예고(DEP0190)했으므로, 셸에 줄 명령줄은 여기서 한 줄로 만든다.
 *
 * 이 한 줄은 파서 둘을 지난다. 먼저 cmd.exe 가 `cmd /d /s /c "<줄>"` 를 읽고, 그다음 실행 파일의
 * CommandLineToArgvW/CRT 가 인자를 나눈다. 그래서 두 파서가 따옴표 짝을 똑같이 세어야 한다:
 *  - 안쪽 큰따옴표는 `""` 로 적는다. `\"` 는 CreateProcess 규칙일 뿐 cmd 는 모르므로, cmd 는 거기서 따옴표가
 *    닫혔다고 보고 뒤에 오는 `&` 를 명령 구분자로 실행해 버린다. `""` 는 양쪽 파서가 모두 리터럴 따옴표로 읽는다.
 *  - cmd 의 메타문자(`& | < > ^ ( ) % !`)가 든 인자는 공백이 없어도 감싼다. 따옴표 안에서는 cmd 가 그것들을 글자로 본다.
 *  - 줄바꿈은 따옴표 안에서도 명령을 끊는다. 어떻게도 감쌀 수 없으므로 거부한다.
 * 남는 한계: `%VAR%` 는 따옴표 안에서도 cmd 가 펼친다. cmd 명령줄에서 `%` 를 막을 방법은 없다 —
 * 인자와 환경변수를 함께 쥔 쪽만 노릴 수 있는 자리라 여기서는 감싸기만 하고 그대로 둔다.
 */
export function commandLine(cmd: string, args: string[]): string {
  return [cmd, ...args].map(quote).join(" ");
}

/** 감싸지 않아도 되는 인자: 두 파서 중 누구도 손대지 않는 글자만 있는 것 */
const BARE = /^[^\s"&|<>^()%!]+$/;

function quote(a: string): string {
  if (/[\r\n\0]/.test(a)) throw new Error(`a command argument cannot contain a newline on Windows: ${JSON.stringify(a)}`);
  if (BARE.test(a)) return a;
  // 따옴표 앞의 역슬래시는 두 배로, 닫는 따옴표 앞의 역슬래시도 두 배로 (CreateProcess 규칙)
  return `"${a.replace(/(\\*)"/g, '$1$1""').replace(/(\\+)$/, "$1$1")}"`;
}

/** spawn/execFile 에 그대로 펼쳐 쓰는 (파일, 인자, shell) 조합 */
export interface Invocation { file: string; args: string[]; shell: boolean }

/**
 * 자식 프로세스 한 번의 호출 방법. win32 는 셸을 거치되 명령줄을 한 줄로 만들어 넘긴다.
 * 빈 args 배열은 DEP0190 을 찍지 않는다 — 경고는 args 가 하나라도 있을 때만 난다.
 * 호출부마다 `platform === "win32" ? ... : ...` 를 따로 쓰면 이번처럼 한 자리를 빠뜨린다 (0.17.2 의 report.ts).
 */
export function invocation(cmd: string, args: string[], platform: NodeJS.Platform = process.platform): Invocation {
  return platform === "win32"
    ? { file: commandLine(cmd, args), args: [], shell: true }
    : { file: cmd, args, shell: false };
}
