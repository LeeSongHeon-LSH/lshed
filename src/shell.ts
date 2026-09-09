/**
 * Windows 에서 `claude.cmd` 같은 래퍼는 셸(cmd.exe)을 거쳐야 찾는다. Node 24 는 args 배열과 `shell: true` 를
 * 함께 주는 것을 폐기 예고(DEP0190)했으므로, 셸에 줄 명령줄은 여기서 한 줄로 만든다. 인자에 공백이나 따옴표가
 * 있으면 큰따옴표로 감싸고 안쪽 큰따옴표는 `\"` 로 적는다 — CreateProcess 가 인자를 나누는 규칙 그대로다.
 */
export function commandLine(cmd: string, args: string[]): string {
  return [cmd, ...args].map(quote).join(" ");
}

function quote(a: string): string {
  if (a !== "" && !/[\s"]/.test(a)) return a;
  return `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}
