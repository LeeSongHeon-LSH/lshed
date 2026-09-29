# lshed — 하네스 휴대 도구 설계 문서 (v0.1)

> **작성일**: 2026-08-31 · **개정**: 2026-09-02 (비판적 검토 반영, 개정 요지는 §13) · 2026-09-05~09-18 (릴리스마다 상태 갱신 — 버전별 요지는 `CHANGELOG.md`) · 2026-09-29 (문서-코드 일치 점검 반영: 구현되지 않은 설계를 사실처럼 적은 곳을 현재 구현에 맞추고, 헤더를 줄이고, 검증 기록은 `docs/VERIFICATION.md` 로 넘김)
> **프로젝트명**: `lshed` (읽기: 엘셰드 / *el-shed*)
> **성격**: 오픈소스 CLI 도구 / 개인 취미 프로젝트로 시작
> **상태 (2026-09-29)**: 0.17.5 (2026-09-18). 버전별로 무엇이 바뀌었는지는 `CHANGELOG.md`, 어느 OS·도구에서 무엇을 확인했는지는 `docs/VERIFICATION.md` 가 기준이다. 열린 것: Copilot CLI 의 모델 질문 probe(COPILOT_GITHUB_TOKEN 대기), Codex 모델 질문은 OpenAI 키가 401 이라 게이트웨이 경유로만 확인됨, `status` 의 placement 문구와 applied 시각(UTC) 표기 다듬기.
> **배포**: GitHub `LeeSongHeon-LSH/lshed`(public), npm `lshed`(latest 0.17.5; 발행은 태그 뒤 사용자가 수동으로, OTP), 릴리스마다 실행파일 5종 + SHA256SUMS (`v*` 태그 push 때 `release.yml` 이 게시, v0.17.5 까지)
> **배경 기록**(비용·수익·연구 연결·폐기 대안): 작성자의 비공개 로컬 노트 `notes/background.md` — `notes/` 는 `.gitignore` 대상이라 저장소에는 없다

---

## 0. 한 줄 정의

> **코딩 에이전트의 하네스(스킬·지침·MCP 등)를 부품으로 쪼개 창고에 두고, 프로필로 조합해 어느 환경에서든 한 줄로 꺼내 적용하는 CLI 도구.**

개발자 본인의 불편에서 출발했으나, 결과물은 범용 도구를 지향한다.

### 0.1 이름의 유래

```
lshed  =  lsh  +  shed
          ↑       ↑
       제작자     창고, 헛간 (장비를 넣어두는 곳)
       이니셜
```

- **shed** — 부품을 넣어두는 **창고**. §3.1의 "창고와 레시피" 구조와 직접 대응한다.
- **shed의 중의성** — "덜어내다"는 뜻도 있어 `lshed prune`(낡은 부품 정리)과 이어진다.
- **lsh** — 제작자 이니셜. `sh`로 끝나 셸 계열 CLI 관례와 어울린다.

---

## 1. 두 축의 구분 ★

### 1.1 제품의 사용자 — **범용**

도구를 쓰는 사람은 하네스를 관리하려는 모든 사람이고, 본인은 그중 첫 번째 사용자일 뿐이다.
따라서 프로필 이름, 부품 카테고리, 창고 위치를 본인 기준으로 고정하지 않는다.

### 1.2 데이터의 흐름 — **사적 (배포가 아니라 휴대)**

각 사용자의 하네스는 그 사용자의 환경들 사이에서만 이동한다. 내 하네스를 남에게 주는 도구가 아니다.

| | 배포 도구 (마켓플레이스, skills.sh 등) | **lshed (휴대)** |
|---|---|---|
| 데이터 방향 | 내 하네스 → 남에게 | 내 하네스 → 내 다른 환경으로 |
| 필요 기능 | 레지스트리, 검색, 발행, 큐레이션 | 프로필 조합, 선택 적용, 부품 관리 |
| 시크릿 | 제외하고 배포 | **키 이름은 휴대, 값은 로컬에서 주입** (§7.1) |
| 남의 스킬 | 찾아주는 게 핵심 | 출처 참조만 기록 (§6.2) |

> **Git과 같은 구조다.** 도구는 공개, 데이터는 사적.

### 1.3 범위 — 사용자 레벨 하네스

v0.1의 대상은 **사용자 레벨 설정**(`~/.claude/` 등)이다.
프로젝트 레벨 설정(`<repo>/.claude/`, `<repo>/CLAUDE.md`)은 그 프로젝트의 git이 이미 옮겨주므로 범위 밖이다.

---

## 2. 문제 정의

### 2.1 문제

새 개발 환경마다 코딩 에이전트의 하네스를 처음부터 다시 세팅해야 한다.
사용자 레벨 설정은 로컬 파일이라 기기 간에 따라오지 않는다.

```
개인 노트북 / 데스크톱 / 회사 장비
WSL / 원격 서버 / 컨테이너
개인 계정 / 업무 계정 (프로필 분리)
```

### 2.2 기존 해법과 한계 — 정직한 비교

dotfiles 관리 도구(chezmoi, GNU Stow, yadm 등)가 사실상 표준이다.
이들이 **못 하는 것**과 **하지 않는 것**을 구분해야 한다. 과장하면 README에서 반박당한다.

| 요구 | dotfiles 도구 | 비고 |
|---|---|---|
| 파일 동기화 | ✅ | 본업 |
| 선택적 설치 | △ | Stow는 패키지 단위, chezmoi는 템플릿 조건. **가능하지만 하네스 단위가 아니다** |
| 환경별 프로필 | △ | 템플릿·브랜치로 흉내 가능. 1급 개념은 아님 |
| 외부 출처 참조·갱신 | ❌ | 남의 스킬을 복사해 넣으면 몇 달 뒤 낡은 채로 돈다 |
| 프로필 전환 시 이전 부품 제거 | ❌ | "관리 집합" 개념이 없음 (§3.5) |
| 미사용 부품 발견 | ❌ | 개념 없음 |
| 시크릿 | ❌ | gitignore로 빼고 수동 |
| 에이전트별 경로·형식 | ❌ | 어디에 뭘 놓을지 사용자가 다 안다고 전제 |

> 요약: dotfiles 도구는 **파일**을 알지만 **하네스**를 모른다.
> lshed의 차별점은 시크릿이 아니라 **하네스 부품·프로필·관리 집합**이라는 1급 개념이다.

### 2.3 관리 대상

카테고리는 **어댑터가 정의**한다(§4.6). Claude Code 어댑터 기준:

| 카테고리 | 실제 위치 | 형태 | 버전 |
|---|---|---|---|
| `skills` | `~/.claude/skills/<name>/` | 디렉터리 | v0.1 |
| `agents` | `~/.claude/agents/<name>.md` | 파일 | v0.1 (skills와 형태가 같아 거의 공짜) |
| `commands` | `~/.claude/commands/<name>.md` | 파일 | v0.1 (동일) |
| `instructions` | `~/.claude/CLAUDE.md` | 조각 → import 목록 생성 (§3.3) | v0.1 |
| `mcp` | `~/.claude.json`의 `mcpServers` 키 | JSON 항목, 시크릿은 `${VAR}` | v0.4 구현 (§7.4) |
| `settings` | `~/.claude/settings.json`의 최상위 키 | 키 하나 = 항목 하나, 병합 없음 | v0.7 구현 (§7.6) |

> **플러그인**(`~/.claude/plugins/`)은 Claude Code가 자체 레지스트리로 설치·갱신하므로 내용을 담지 않는다.
> §3.7 의 "설치한 것"으로, `claude-marketplace:<owner/repo>`·`claude-plugin:<name>@<marketplace>` 패키지로 기록한다(0.3.0, §7.5).
> `settings.json` 의 `enabledPlugins`·`extraKnownMarketplaces` 는 설치기가 만드는 상태라 담지 않는다(§7.6).
> 프로젝트 스캐폴드는 **범위 밖**이다. 하네스 휴대와 무관하고 degit·cookiecutter의 영역이다.

---

## 3. 핵심 설계 개념

### 3.1 창고와 레시피의 분리 ★

```
[창고 Components]  사용자가 가진 모든 부품 — 카테고리별 디렉터리
[레시피 Profiles]  어떤 환경에 무엇을 조합할지 — 사용자가 이름과 구성을 정의
```

- "일부만 가져오기"가 자연스럽게 성립한다.
- **창고에서 버리기**(`remove`)와 **레시피에서 빼기**(YAML 편집)가 구분된다.
- 같은 부품을 여러 프로필이 공유한다.
- 프로필은 v0.1부터 복수다. 하나뿐이면 이 분리가 무의미하다.

### 3.2 창고 디렉터리와 매니페스트

창고는 **그냥 디렉터리**다. 어디에 두고 어떻게 동기화할지(git, Dropbox, rsync)는 사용자 몫이다.

```
~/harness/                 # 창고 (위치는 사용자 지정, LSHED_HOME 또는 --shed)
├── lshed.yaml             # 매니페스트
├── skills/paper-review/
├── agents/reviewer.md
├── commands/summarize.md
└── instructions/base.md
```

```yaml
# lshed.yaml
version: 1
agent: claude-code            # 어댑터 (카테고리 집합을 결정)

components:
  skills:
    - id: paper-review
      source: file:./skills/paper-review
  agents:
    - id: reviewer
      source: file:./agents/reviewer.md
  commands:
    - id: summarize
      source: file:./commands/summarize.md
  instructions:
    - id: base
      source: file:./instructions/base.md
    - id: research-style
      source: file:./instructions/research.md

packages:                     # 남의 코드(원격 출처)는 부품이 아니라 패키지로 (§3.7)
  - id: superpowers
    source: github:obra/superpowers@v2.1
    into: skills/superpowers

profiles:                     # 이름은 예시. 사용자가 정의한다
  research:
    skills: [paper-review]
    packages: [superpowers]
    agents: [reviewer]
    instructions: [base, research-style]      # 순서대로
  teaching:
    skills: [grading-helper]
    instructions: [base, teaching-style]
  laptop:
    extends: research                         # research 전부 + 아래. 부모 것이 앞, 빼기는 없음
    instructions: [laptop-rules]
```

관례: `source`를 생략하면 `file:./<category>/<id>`로 간주한다. `init`이 만드는 매니페스트는 대부분 이 형태다.

부품의 출처는 `file:` 뿐이다. 초안은 부품에도 `github:` 원격 리졸버를 두려 했으나, 0.2.0 에서 원격 코드는 **패키지**(`packages:` + `into:`, §3.7)로 풀었고 부품용 원격 출처는 구현하지 않았다. 매니페스트 검증이 부품의 `github:`/`git:` 출처를 거부하고 `packages:` 를 쓰라고 안내한다.

### 3.3 지침 파일 — 병합하지 않고 import 한다

Claude Code의 `CLAUDE.md`는 `@path` 문법으로 다른 파일을 불러올 수 있다.
따라서 조각을 이어붙이는 대신 **import 목록을 생성**한다.

```markdown
<!-- generated by lshed; profile: research -->
<!-- Do not edit this file. Edit the fragments in your shed and run 'lshed restore'. -->

@lshed/instructions/base.md
@lshed/instructions/research-style.md
```

조각은 `<root>/lshed/instructions/<id>.md` 에 놓이고(파일 이름은 창고 쪽 파일명이 아니라 조각 id), import 경로는 CLAUDE.md 기준 상대 경로라 홈이 달라도 그대로다(§11).

- 섹션 충돌 병합 문제(구 §7.2)가 사라진다.
- 조각을 편집하면 그대로 반영된다.
- import를 지원하지 않는 어댑터는 **단순 연결**로 폴백한다. `<!-- <id> -->` 머리를 단 조각 본문을 순서대로 잇는다.
- 기존 `CLAUDE.md`가 lshed 생성물이 아니면 백업 후 교체하고 경고한다.

### 3.4 소유권 규칙 — 창고가 진실이다

양방향 동기화는 만들지 않는다. 방향을 고정한다.

| 출처 | 로컬에서 편집 | `save` | 갱신 |
|---|---|---|---|
| `file:` 부품 | 가능 | 로컬 → 창고 반영 | 해당 없음 |
| 패키지 (`github:`/`git:`/플러그인, §3.7) | 사용자 몫 (clone 은 건드리지 않음, 락과 다르면 `status` 가 알림) | 대상 아님 | `lshed update` 가 pull + 락 갱신 |

`save`는 "로컬에서 고친 것을 창고로 되가져오기"이며 `file:` 부품에만 적용된다. 원격 출처는 부품이 아니라 패키지다.

### 3.5 상태 모델 — 관리 집합

lshed는 기기별 상태 파일에 **자기가 놓은 경로 목록**(관리 집합)을 기록한다.

```
~/.claude/lshed/state.json      # 어댑터 루트 아래, 창고에는 포함하지 않는다
{
  "profile": "research",
  "shed": "/home/me/harness",
  "managed": ["skills/paper-review", "agents/reviewer.md", "lshed/instructions/base.md", "CLAUDE.md", "mcp:exa"],
  "appliedAt": "2026-09-02T10:00:00Z",
  "link": true,                    // 선택. restore --link 로 놓았으면 (§3.6)
  "failedInstalls": ["gstack"]     // 선택. 마지막 restore 에서 install: 이 실패한 패키지 (0.17.4)
}
```

- 프로필 전환 시 **관리 집합에 있는 경로만** 제거한다. 사용자가 손으로 둔 파일은 건드리지 않는다.
- 관리 집합에 없는데 대상 경로에 이미 무언가 있으면 **백업 후 덮어쓴다**(§5.1).
- `status`, `diff`는 이 파일을 기준으로 동작한다.
- 스키마 전체는 `src/state.ts`.

### 3.6 배치 방식 — 기본은 복사, 기기별로 `--link`

무시 목록(`node_modules`, `.git`, 캐시류)은 복사·해시·diff·백업이 공유한다.
빌드 산출물(`dist`)은 스킬에 따라 그것이 곧 실행 대상이므로 기본 무시 대상이 아니다.
심볼릭 링크로 걸린 부품은 내용으로 복사한다.

기본은 **복사**한다. 편집 반영은 `diff` + `save`로 명시적으로 한다.

**`--link` (2026-09-04, 0.10.0).** 편집을 많이 하는 기기에서는 `restore --link` 로 파일 부품(skills/agents/commands/지침 조각)을 창고로 가는 링크로 놓는다. 편집이 창고에 바로 가므로 diff/save 가 할 일이 없고 sync 만 하면 된다.
- 기기별 opt-in 이고 state.json 에 기록되어 이후 인자 없는 restore 도 링크를 유지한다. `--no-link` 로 복사로 돌아간다. 다른 기기는 영향 없다. 링크를 기본으로 하지 않는 이유: 창고가 없는 순간(sync 실패, 창고 이동) 하네스가 통째로 깨지고, 기존 기기 전부가 재배치되기 때문.
- 항목형(mcp/settings)은 JSON 값이라 항상 쓴다. CLAUDE.md 는 생성물이라 실제 파일이다.
- Windows: 디렉터리는 junction(권한 불필요), 파일 링크는 개발자 모드가 없으면 실패 → 복사로 폴백하고 알린다. 폴백된 부품은 여느 복사본처럼 diff/save 대상이다. 모드는 그대로 남아 다음엔 링크가 될 수 있다.
- 제거는 `fs.rm` 이 링크를 따라가지 않으므로 링크만 지운다. 프로필 전환이 창고를 지우지 않는 근거.
- 복사본→링크 전환은 내용이 같으면 백업 없이, 다르면(저장 안 한 편집) 백업하고 바꾼다. 링크→복사는 백업이 필요 없다(내용이 창고에 있다).
- Claude Code 가 링크된 스킬을 읽는 근거: gstack 의 `./setup` 이 스킬을 심볼릭 링크로 놓고, 그 상태로 사용되고 있었다. 지침 조각은 `@import` 가 일반 파일 읽기라 링크를 따라간다.

### 3.7 하네스의 세 종류 ★ (도그푸딩에서 나옴, §14)

| 종류 | 예 | npm 비유 | lshed |
|---|---|---|---|
| 내가 쓴 것 | add-drivers, CLAUDE.md 조각 | 소스 | 내용을 복사한다 (§3.4) |
| 설치한 것 | gstack(git clone), 플러그인 | package.json 의존성 | 출처·커밋만 기록. 복원 시 clone + install |
| 설치가 만들어낸 것 | gstack 스텁 53개 | node_modules, dist | 담지도 관리하지도 않는다 |

```yaml
packages:
  - id: gstack
    source: github:garrytan/gstack@main      # 또는 git:<url>#ref
    into: skills/gstack                       # 어댑터 루트 기준
    install: ./setup                          # 선택. --yes 일 때만 실행 (이미 있는 패키지에도)
```

`github:` 출처의 `#path` 하위 경로는 패키지에 쓸 수 없다(검증에서 거부). 저장소 전체를 `into` 에 clone 한다.

**감지 규칙 (init)**
- 부품 안에 `.git`이 있고 origin이 있으면 → 설치한 것. 원격 URL과 HEAD를 읽어 `source`와 락을 채운다.
- 부품 최상위의 심볼릭 링크가 어떤 패키지 안을 가리키면 → 그 패키지가 만들어낸 것. 끊어진 링크도 목적지는 안다.
- 설치 관리자가 링크 없이 만드는 별칭 디렉터리는 잡을 수 없다. `--exclude`로 뺀다. (gstack의 `_gstack-command`, `connect-chrome`)
- `install:`은 자동으로 알 수 없다. 주석으로 자리만 남긴다.

**복원 규칙**
- 패키지가 없으면 `lshed.lock`의 커밋으로 clone한다. 락이 없으면 clone된 HEAD를 락에 적는다.
- 이미 있으면 절대 건드리지 않는다. 사용자가 올렸을 수 있다. 락과 다르면 `status`가 알려준다.
- `install:`은 임의 셸 명령이다. 창고는 어디서든 clone될 수 있으므로 **`--yes` 없이는 보여주기만 하고 실행하지 않는다.** `--yes`는 "install 명령을 돌려라"는 뜻이라 이미 있는 패키지에도 돌린다 — 첫 restore가 "rerun with '--yes'"라고 안내하므로 그 말이 참이어야 하고, `update --yes`가 pull마다 다시 돌리므로 install 스크립트는 어차피 멱등이어야 한다. `--dry-run`이면 돌리지 않는다.
- 패키지는 **관리 집합에 넣지 않는다.** 프로필 전환이 clone을 지우지 않는다. 백업하며 지우려면 저장소를 통째로 복사해야 하는데 그건 잘못된 도구다.
- **실패해도 나머지는 계속한다(0.17.2~0.17.4).** clone·플러그인 설치가 실패한 패키지, `install:` 이 실패한 패키지를 모아 끝에 한꺼번에 알리고, 부품 배치와 state 기록은 끝까지 한다. 종료 코드는 1. `install:` 실패는 state 의 `failedInstalls` 에 남아 `status` 가 보여 준다(없으면 멀쩡한 기기와 구별되지 않는다). `update` 도 pull 못 한 패키지를 건너뛰고 나머지를 올린 뒤 락을 쓴다.

**`lshed update [id]`** — `git pull --ff-only` 후 락 갱신. `--yes`이면 `install:`을 다시 돌린다 (커밋이 바뀌었든 이미 최신이든).

---

## 4. 범용 도구로서의 요구사항 ★

### 4.1 하드코딩 금지

프로필 이름, 창고 위치, 부품 카테고리, 에이전트 경로를 코드에 고정하지 않는다.
카테고리와 경로는 어댑터가, 나머지는 매니페스트가 정한다.

### 4.2 온보딩 — `init`이 첫 경험

```bash
lshed init --shed ~/harness     # 현재 ~/.claude를 스캔 → 창고에 복사 + lshed.yaml 생성
```

- 발견한 것을 세 종류로 가른다(§3.7, 0.2.0): 내가 쓴 것은 `file:` 부품으로 창고에 복사, 설치한 것(git clone·플러그인·마켓플레이스)은 출처·버전만 적은 패키지, 설치가 만들어낸 것(패키지 안을 가리키는 링크)은 건너뜀. 전부 `default` 프로필(`--profile` 로 바꿀 수 있음) 하나에 넣는다.
- 링크 없이 만든 별칭은 감지되지 않으므로 `--exclude` 로 뺀다. 뺀 것은 매니페스트의 `exclude:` 에 남아 `add`/`status` 가 따른다.
- 에이전트 루트가 없으면 빈 창고를 쓰지 않고 거부한다(있는 루트를 들어 `--agent` 를 권함, 0.17.0). 창고에 `lshed.yaml` 이 이미 있으면 거부하고 `add` 나 `restore` + `save` 를 안내한다.
- 빈 매니페스트를 손으로 채우게 하면 대부분 이탈한다.

### 4.3 문서가 제품의 일부

README = UI. 30초 개요, 복사해서 되는 Quick Start, 매니페스트 레퍼런스, 실패 시 대처법.

### 4.4 동기화는 도구 밖

창고는 디렉터리이므로 `git clone <내 창고>` 뒤 `lshed restore research`면 끝이다.
v0.1에 저장소 백엔드 추상화는 두지 않는다. `lshed sync`(git pull/push 래퍼)는 편의 기능이다 (0.6.0 구현).
commit → pull --rebase → push 를 묶고, 충돌이면 rebase 를 되돌려 창고를 깨끗하게 둔다. save 는 대신 해 주지 않고 경고만 한다.

### 4.5 크로스 플랫폼

| 항목 | 고려사항 |
|---|---|
| 경로 구분자 | `path.join` 외 직접 조립 금지 |
| 홈 디렉터리 | `os.homedir()` 단일 창구 |
| 줄바꿈 | 지침 파일은 그대로 복사, 생성 파일은 LF |

경로 비교는 `fsutil.ts`(`normalizePath`/`isInside`/`realpathish`), 자식 프로세스 호출은 `shell.ts`(`invocation`/`commandLine`: Windows 명령줄은 `""` 이스케이프, `%`·줄바꿈이 든 인자는 거부)에 모은다. 그 밖의 win32 분기는 `core/check.ts`(PATHEXT, `taskkill` 로 프로세스 트리 종료), `core/report.ts`(PowerShell 로 브라우저 열기, 홈·8.3 이름 가림), `core/entries.ts`(`${HOME}` 의 `C:/` 표기), `core/restore.ts`(링크 폴백)에 있다. 0.7.4~0.7.5 에서 CI 가 macOS·Windows 러너에서 실제로 돌며 경로 비교 버그 셋을 잡았고(§10.1), 지금은 ubuntu/macos/windows × node 20/22 매트릭스와 각 OS 의 CLI 스모크가 push 마다 돈다(단독 실행파일은 태그 때만 빌드되고 linux-x64 하나로 스모크). Windows 는 `--link` 에 junction, 파일 링크는 개발자 모드 없으면 복사 폴백.

### 4.6 에이전트 어댑터

```
AgentAdapter
  categories(): { name, root, kind: "dir" | "file" }[]
  instructionsStrategy(): "import" | "concat"
  scan(): 현재 설치된 부품 목록
```

실제 인터페이스는 여기에 `entries()`(MCP·settings 같은 JSON/TOML 항목형 카테고리), `installers()`(플러그인 같은 어댑터 고유 설치기), `instructionsFileName()`(null 이면 지침 없음)이 더 있다(`src/adapters/types.ts`).

어댑터 둘: `ClaudeCodeAdapter`(skills·agents·commands·instructions·mcp·settings, 플러그인 설치기)와, Agent Skills 표준을 따르는 도구들을 스펙 표 하나로 다루는 `SkillsDirAdapter`(`src/adapters/skills-dir.ts`). 스펙(0.14.1):

| `--agent` | 루트 | 스킬 | 지침 | MCP |
|---|---|---|---|---|
| `codex` | `$CODEX_HOME` 또는 `~/.codex` | `~/.agents/skills` (루트 밖, `skillsHome`) | `AGENTS.md` 이어붙임 | `config.toml` `[mcp_servers.*]` (TomlEntries, 변수 이름) |
| `gemini` | `~/.gemini` | `skills/` | `GEMINI.md` 이어붙임 | `settings.json` (httpUrl, restore 가 값 채움) |
| `copilot` | `$COPILOT_HOME` 또는 `~/.copilot` | `skills/` | `copilot-instructions.md` 이어붙임 | `mcp-config.json` (type local, tools) |
| `cursor` | `~/.cursor` | `skills/` | 없음 | `mcp.json` (`${env:VAR}`) |
| `agy` | `~/.gemini/config` | `skills/` | `../AGENTS.md` 이어붙임 | `mcp_config.json` (serverUrl, restore 가 값 채움) |
| `agents` | `~/.agents` | `skills/` | 없음 | 없음 |

카테고리 루트는 어댑터 루트 기준 상대 경로라 `../.agents/skills` 처럼 위로 갈 수 있고, 백업은 `..` 을 `__` 로 바꿔 백업 디렉터리 안에 머문다. 창고 쪽 경로는 카테고리 *이름* 으로만 만든다.

**어느 어댑터를 쓰나** (`src/cli.ts` `adapterFromOpts`, `src/core/detect.ts`, 0.17.0):

1. `--agent <name>`, 없으면 `LSHED_AGENT`
2. `--shed` 나 `LSHED_HOME` 이 주어졌으면 그 창고 `lshed.yaml` 의 `agent:` (창고 위치를 state 에서 가져오는 경우는 어댑터가 먼저 필요하므로 보지 않는다)
3. `--root` 가 없으면 이 기기의 lshed 상태: claude-code 에 상태가 있으면 claude-code, 없으면 상태가 있는 유일한 에이전트, 둘 이상이면 오류("More than one agent here has lshed state … Say which")
4. 그래도 없으면 `claude-code`

`restore --agent installed` 는 PATH 에 CLI 가 있는 에이전트 전부에 차례로 복원한다(0.17.5, 컨테이너·셸 부트스트랩용. `--shed`/`LSHED_HOME` 필수, `--pick`·`--root` 와 함께 못 씀).

### 4.7 코드 지도

```
src/cli.ts                 commander 진입점. 전역 옵션, 어댑터 선택(§4.6), 실패 뒤 report 제안
src/core/                  명령별 로직
  init · add · discover · ingest     스캔 → 세 종류 분류(§3.7) → 창고에 담기 (init/add 공용)
  restore · pick · instructions      계획 → 패키지 → 제거 → 배치 → 지침 생성, --pick 체크리스트
  status · diff · save · sync        드리프트, 되가져오기, git 래퍼
  list · remove                      창고 관리, prune
  packages                           패키지 감지·생성물 감지·ensure/update·락
  entries                            항목형 JSON: 마스킹·확장·비교, ${HOME} 처리 (§7.4)
  context                            Ctx, 매니페스트 읽기, 프로필 계획, 경로 규칙
  detect                             에이전트 자동 감지, --agent installed
  check · report                     lshed check / lshed report (§5)
src/adapters/              registry → ClaudeCodeAdapter | SkillsDirAdapter(스펙 6개)
                           json-entries · toml-entries · mcp-forms (도구별 MCP 형식 변환)
src/installers/            git.ts(core, github:/git:) · claude-plugin.ts(Claude Code 어댑터가 제공: claude-marketplace·claude-plugin)
src/resolvers/file.ts      file: 만 창고 경로로 (§6.1)
src/manifest.ts · source.ts · state.ts · lock.ts · ignore.ts · fsutil.ts · git.ts · shell.ts
```

---

## 5. 명령어 설계

설계상 의미 있는 명령만 적는다. 플래그까지 전부는 README 의 Reference 절(`lshed --help` 와 같음)이 기준이다.

```bash
# ── 초기화 ──
lshed init [--shed <dir>] [--profile <name>] [--exclude <id...>]   # 스캔 → 창고 + 매니페스트    v0.1
lshed add [<key>...] [--all]     # init 이후 생긴 것을 창고에 (키 없으면 목록만)        v0.5
lshed scan                       # 루트에 무엇이 있는지만 (쓰지 않음)                   v0.7.2

# ── 적용 ──
lshed restore <profile>          # 프로필 적용 (관리 집합 교체)                       v0.1
lshed restore                    # 마지막 프로필 재적용 (처음이고 터미널이면 --pick)   v0.1
  --pick                         # 카테고리별 체크리스트 → 프로필 저장                 v0.8
  --link | --no-link             # 파일 부품을 창고로 가는 링크로 (기기별 기억)        v0.10
  --yes                          # 패키지 install: 실행 (§3.7)                          v0.2
  --fresh-only                   # 상태가 이미 있는 루트는 그대로 (exit 0)              v0.17.5
lshed status                     # 현재 프로필, 관리 집합, 드리프트, 패키지 요약        v0.1
lshed diff                       # 로컬 vs 창고 파일 차이                              v0.1

# ── 되가져오기 ──
lshed save [<id>...]             # 로컬 편집을 창고로 (file: 출처만)                   v0.1

# ── 창고 관리 ──
lshed list [--unused]            # 창고 목록 / 어떤 프로필에도 안 쓰이는 부품          v0.2
lshed remove <key>               # 창고에서 삭제 (프로필 참조가 있으면 거부)           v0.2
lshed prune [--yes]              # 미사용 부품 일괄 정리 (--yes 없으면 목록만)         v0.2
lshed update [<id>...] [--dry-run] [--yes]   # 패키지 pull + 락 갱신; --dry-run 은 업스트림만 조회   v0.2
lshed sync [-m] [--no-push] [--dry-run]      # 창고 commit + pull --rebase + push   v0.6

# ── 확인·보고 ──
lshed check [--attempts <n>] [--timeout <s>] # 암호어 스킬을 놓고 에이전트 CLI 에 물어 실제로 읽는지 (기본 2회, 120초)   v0.17
lshed report [--open | --url]    # 이슈에 붙일 요약 (홈 경로 가림); 실패 뒤 제안         v0.16

# ── 전역 ──
--shed <dir> (LSHED_HOME)  --agent <name> (LSHED_AGENT, restore 에선 installed 도)  --root <dir>  -V/--version
```

`check`·`report` 는 조용한 실패(에이전트가 부품을 안 읽는데 lshed 는 성공이라 말하는 것)에 대한 답이다. 텔레메트리는 두지 않는다: 확인은 사용자가 `check` 로 하고, 보고는 사용자가 `report` 요약을 보고 직접 이슈에 붙인다. 어느 명령이든 오류로 끝나면 터미널에서는 요약을 채운 이슈 폼을 열지 묻고(기본 아니오, `LSHED_REPORT=0` 이면 묻지 않음), restore 가 안내 줄을 냈을 때만 "If any of the above is not what you expected: lshed report" 를 붙인다. lshed 가 어딘가로 보내는 것은 없다 — 브라우저를 열 뿐이다.

프로필 편집 명령은 두지 않는다. `lshed.yaml`을 직접 고치는 편이 어떤 UI보다 낫다.

### 5.1 restore 안전 장치

```
--dry-run        바뀔 목록만 출력 (install: 도 플러그인 설치도 돌리지 않음)
--no-backup      백업 생략 (기본은 ~/.claude/lshed/backups/<timestamp>/ 에 백업)
--yes            패키지의 install: 셸 명령을 실행. 없으면 보여주기만 한다 (§3.7). clone·플러그인 설치는 이것과 무관
```

> 백업이 기본이다. 남의 설정을 날리는 도구가 되면 끝이다.
> v0.1은 대화형 확인 프롬프트를 두지 않는다. 백업 + `--dry-run`이 안전 장치다.

---

## 6. 확장을 위한 설계 원칙

### 6.1 리졸버 인터페이스

초안은 `Resolver.resolve(source)` 인터페이스 아래 `FileResolver`(v0.1)·`GitHubResolver`(v0.2)·`RegistryResolver`(미정)를 두려 했다. 실제로는:

- `resolvers/file.ts` 는 함수 둘(`resolveSource`, `isSaveable`)이고 `file:` 만 창고 안 경로로 바꾼다.
- 원격 출처는 리졸버가 아니라 **설치기**(`Installer`, §7.5)로 구현했다. 원격 코드는 부품이 아니라 패키지이기 때문이다(§3.7). `github:`/`git:` 은 core 의 git 설치기, 플러그인은 어댑터의 설치기가 맡는다.
- 부품용 원격 리졸버는 계획에 없다.

매니페스트를 읽는 코드가 네트워크를 직접 호출하지 않는다는 원칙은 그대로다.

### 6.2 식별자에 스킴 포함 — v0.1부터

```yaml
source: file:./skills/x                      # 부품
source: github:user/repo@v1.0                # 패키지
source: git:https://gitlab.com/u/r.git#v1.0  # 패키지 (github 이 아닌 git 원격)
source: github:user/repo@v1.0#path/in/repo   # 문법은 파싱되지만 패키지에서는 거부 (하위 경로 clone 미구현)
```

스킴 문법은 공짜이므로 v0.1부터 쓴다. 나중에 도입하면 호환성 문제가 생긴다.

### 6.3 락파일 — 패키지 전용 (v0.2 구현)

`lshed.lock`은 패키지(§3.7)의 정확한 커밋을 기록한다. `file:` 부품은 창고 자체가 git으로 버전되므로 잠글 게 없다.
`init`(기존 clone에서), `restore`(첫 clone 시), `update`가 쓴다. 창고에 들어가며 커밋한다.

---

## 7. 난제

### 7.1 시크릿 — 정직한 위치

MCP 설정에 API 키가 들어가고, 창고는 git에 올라간다.
**lshed는 시크릿 값을 휴대하지 않는다.** 휴대하는 것은 "어떤 키가 필요한가"뿐이다.

| 방식 | 채택 |
|---|---|
| A. 키 이름만 매니페스트에 저장, restore 시 환경변수/프롬프트로 주입 | ✅ v0.2 (MCP와 함께) |
| B. 로컬 암호화 후 창고에 저장 | 미정. 복호화 키 관리가 또 다른 시크릿 문제 |
| C. 외부 매니저 참조 (`op://...`) | 후보. 의존성 추가 |
| D. OS 키체인 | 후보. 플랫폼별 구현 |

> 이 결정의 의미: 시크릿에서 lshed는 dotfiles와 **동급**이다. 차별점은 §2.2의 다른 항목이다.

### 7.2 기존 설정 덮어쓰기

관리 집합(§3.5) + 백업 기본(§5.1) + `--dry-run`.
`init`은 기존 파일을 읽기만 한다. 쓰는 곳은 창고와 `<root>/lshed/`뿐이다.

### 7.3 에이전트 사양 변경

Claude Code는 계속 새 개념(plugins, subagents 등)을 추가한다.
카테고리 집합을 어댑터가 반환하게 하면 새 카테고리 추가는 어댑터 한 줄이다.

### 7.4 MCP — 항목형 부품 (v0.4 구현)

Claude Code의 사용자 레벨 MCP는 `~/.claude.json`에 다른 상태값(machineID, 세션 기록 등)과 함께 있다.
파일 단위 부품이 아니라서 **항목형 카테고리**(`EntryCategory`)를 어댑터 경계에 추가했다.

```
EntryCategory { name, kind: "entry", secretKeys, secretRootIds?, expandsEnv, homeStaysPlaceholder?, read(), write(id, value|null) }
```

(전체와 각 멤버의 뜻은 `src/adapters/types.ts`)

- 창고에는 `mcp/<id>.json`. 배치는 `mcpServers.<id>` 키 하나만 바꾸고 파일은 임시 파일 → rename.
- 관리 집합에는 `mcp:<id>` 로 적는다. 경로 구간에 `:` 이 못 오므로 파일과 구분된다.
- **시크릿은 §7.1 A 그대로.** `env`·`headers` 아래 시크릿 같은 키의 값을 `${VAR}` 로 바꾼다.
  Claude Code 가 모든 범위에서 `${VAR}` 를 스스로 확장하므로(실제 바이너리로 검증) `restore` 는 시크릿 자리표시자를 그대로 놓는다. `${HOME}` 만은 lshed 가 채운다(0.15.4): Claude Code 는 환경에 있는 변수만 채우고 Windows 에는 HOME 이 없어, HOME 이 없는 환경에서는 "Missing environment variables: HOME" 을 내고 서버를 띄우지 않는 것을 2.1.265 로 실측했다(`CLAUDE_CONFIG_DIR` 격리 + `claude mcp list`, 마커 파일).
  시크릿 값은 lshed 를 한 번도 거치지 않는다. `expandsEnv: false` 인 어댑터를 위해 `expand()` 는 남겨 두었다.
- `diff`/`save` 에서 자리표시자는 와일드카드다. 로컬에 실제 값이 들어 있어도 드리프트가 아니고, `save` 는 자리표시자를 보존하며 새 시크릿 키를 마스킹한다.
- 휴리스틱(키 이름 정규식)은 제안이다. `args`·`url` 의 토큰 같은 문자열은 경고만 하고, 확정은 사용자가 창고 json 을 고쳐서 한다.
- `claude mcp add-json` 대신 직접 쓰는 이유: 읽기는 어차피 JSON 을 봐야 하고, `claude` 없이도 테스트·복원이 되며, 한 키만 바꾸는 것이 CLI 호출보다 결정적이다.
- 프로젝트 범위 MCP(`.mcp.json`, `projects.*`)는 §1.3 대로 다루지 않는다.

### 7.5 플러그인 — 패키지의 한 종류 (v0.3 구현)

Claude Code 플러그인은 §3.7의 "설치한 것"이다. clone이 아니라 `claude plugin install`로 설치되므로
**설치기(installer) 인터페이스**를 두고 어댑터가 자기 설치기를 제공한다.

```
Installer { name, schemes, priority, detect, status, install, update, upstream?, describe, cwd }   // 전체는 src/installers/types.ts
├── git              core      github: / git:            priority 0
├── claude-marketplace  어댑터  claude-marketplace:<owner/repo>   10
└── claude-plugin       어댑터  claude-plugin:<name>@<marketplace> 20
```

- 설치 순서는 priority. 마켓플레이스가 플러그인보다 먼저다.
- 플러그인은 버전 고정이 안 된다. 락은 "실제 설치된 것"을 적고, 다르면 status가 알린다.
- 플러그인 설치는 에이전트 자신의 패키지 관리자이므로 `--yes` 없이 실행한다. `--yes`는 `-y`로 넘어간다.
- 프로젝트 범위 플러그인은 그 프로젝트의 몫이라 기록하지 않는다(§1.3).
- 이 사용자 환경에서는 exa·notion 플러그인이 MCP 서버를 실어 온다. 손으로 넣은 MCP 는 0.4.0 부터 `mcp` 항목형 부품(§7.4)이다.

---

### 7.6 settings.json — 병합하지 않는다 (v0.7 구현)

초안은 "JSON 병합 (병합 규칙 필요)" 이었다. 규칙을 설계하는 대신 §7.4 의 항목형 카테고리를 그대로 썼다:
**최상위 키 하나가 부품 하나**다 (`settings/permissions.json`, `settings/hooks.json`). 창고가 그 키를 통째로 소유한다.

- 병합 규칙이 필요 없다. 배열(permissions.allow, hooks)의 합치기·중복·순서 문제가 사라진다.
- 로컬에서 권한을 더 주면 diff 에 보이고 save 로 되가져온다. 스킬과 같은 규칙(§3.4).
- 프로필이 키를 고른다. `permissions`·`hooks` 는 옮기고 `model` 은 기기마다 다르게 둘 수 있다.
- `enabledPlugins` 는 플러그인 설치기가 만드는 상태라 담지 않는다 (§3.7 의 "설치가 만들어낸 것").
- 홈 아래 절대경로는 `${HOME}/…` 로 담는다. `${HOME}` 뒤는 늘 `/` (Windows 의 `C:\Users\me\…` 도, 대소문자가 달라도 홈으로 알아본다) 이고, Windows 복원은 `C:/Users/me/…` 로 채운다 — 창고가 OS 를 가리지 않게. 드리프트 비교(`stringMatches`)도 `${HOME}` 문자열은 구분자·대소문자를 무시한다. settings.json 은 Claude Code 가 `${VAR}` 를 안 채우므로 `expandsEnv: false` — restore 가 셸 환경으로 채운다. MCP 는 여전히 Claude Code 가 채운다.
- 실환경: gstack setup 이 써 넣은 Stop 훅은 "패키지 안을 가리킴" 으로 감지되어 exclude 했다. 부분 소유(배열 일부만 생성물)는 다루지 않는다. 키 단위가 한계이고, 감지는 제안이다.

---

## 8. 버전 로드맵

```
v0.1  최소 동작 — 본인이 매일 쓸 수 있는 수준
   - 어댑터: Claude Code (skills, agents, commands, instructions)
   - init / restore / status / diff / save
   - 프로필 복수 지원, 관리 집합, 백업 기본, --dry-run
   - FileResolver만 구현, 스킴 문법은 적용
   - 임시 HOME 통합 테스트
   - README 초안

v0.2  남이 쓸 수 있는 수준
   ✓ packages (github:/git: 출처, lshed.lock, update, install --yes)  ← 0.2.0
   ✓ list --unused / remove / prune                                    ← 0.2.1
   ✓ 플러그인·마켓플레이스를 packages 로 (설치기 인터페이스)            ← 0.3.0
   ✓ MCP (손으로 넣은 것. 시크릿은 ${VAR} 자리표시자)                 ← 0.4.0
   ✓ add (init 의 증분판. 감지는 제안, 확정은 사용자)                  ← 0.5.0
   ✓ sync (commit·pull --rebase·push. 충돌이면 되돌림)                 ← 0.6.0

v0.3
   ✓ settings.json — 병합 대신 키 단위 소유 (§7.6)                       ← 0.7.0
   ✓ 의존성 번들 + 단독 실행파일 5종 + 릴리스 워크플로                   ← 0.7.3
   ✓ macOS / Windows — CI 러너에서 잡은 경로 버그 셋 수정, 3 OS 스모크     ← 0.7.4~0.7.6
   ✓ restore --pick (카테고리별 체크리스트 → 프로필 저장)                 ← 0.8.0
   ✓ 프로필 extends                                                     ← 0.9.0
   ✓ restore --link (기기별, Windows junction)                          ← 0.10.0

v0.4  다른 도구
   ✓ --agent codex|gemini|copilot|cursor|agents (SkillsDirAdapter)     ← 0.11.0
   ✓ 타 도구 MCP 형식 변환 (Codex config.toml 표 편집)                   ← 0.12.0
   ✓ VM probe (scripts/vm), CLAUDE_CONFIG_DIR 아래 .claude.json         ← 0.12.1
   ✓ --agent agy (Antigravity)                                          ← 0.13.0
   ✓ Codex 스킬을 ~/.agents/skills 로                                    ← 0.14.0
   ✓ 도그푸딩이 잡은 셋 (마켓플레이스/플러그인 id, extraKnownMarketplaces, 빈 JSON) ← 0.14.1

알려진 문제 (2026-09-08, §11)
   ✓ CI Windows 잡의 sync 테스트 5초 타임아웃 플레이크 (테스트에 30초 여유)
   ✓ update --dry-run 이 업스트림을 안 봄 (설치기 upstream(), git ls-remote)      ← 0.14.2

v0.5  조용한 실패와 보고
   ✓ CLI 출력 영어화, Windows 실기기 검증이 잡은 것들                    ← 0.15.0~0.15.5
   ✓ lshed report · 이슈 템플릿 · 실패 뒤 질문                            ← 0.16.0~0.16.1
   ✓ lshed check · 에이전트 자동 감지                                    ← 0.17.0
   ✓ 보안 수정 셋, 실패해도 계속하는 restore/update                       ← 0.17.1~0.17.4
   ✓ restore --fresh-only · --agent installed, 컨테이너 probe             ← 0.17.5

검증 (사용자 기기·키 필요, 기록은 docs/VERIFICATION.md)
   ✓ Gemini CLI · Cursor probe, 모델 질문까지 (컨테이너, 2026-09-18)
   - Copilot CLI 모델 질문 (배치·형식은 통과, COPILOT_GITHUB_TOKEN 대기)
   ✓ 실제 Windows 기기에서 §10.1 3층 (0.15.1~0.17.3)

이후 (선택)
   - 시크릿 B~D 옵션
   - 다른 도구의 settings·rules 폴더·플러그인 (지금은 스킬·지침·MCP 만 옮긴다)
```

> v0.1부터 §4의 범용성 원칙(하드코딩 금지, 어댑터 경계, 스킴 문법)은 지킨다. 나중에 고치는 비용이 더 크다.

---

## 9. 기술 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 언어 | TypeScript, ESM | 타입이 매니페스트 스키마 실수를 잡아준다 |
| 런타임 | Node ≥ 20, 또는 단일 실행파일 | 아래 §9.1 참조 — 초기 가정이 틀렸다 |
| CLI | `commander` | 충분히 작고 표준적 |
| 스키마 | `zod` + `yaml` | 매니페스트 검증 오류를 사람이 읽을 수 있게 |
| 테스트 | `vitest` | 임시 디렉터리를 HOME으로 잡는 통합 테스트 중심 |
| 빌드 | `tsup` | 단일 파일 번들, `bin` 하나 |
| 프롬프트 | `@clack/prompts` | `restore --pick` 체크리스트(0.8.0), 실패 뒤 report 질문 |
| TOML | `smol-toml` | Codex `config.toml` 읽기와 표 블록 생성(0.12.0). 쓰기는 블록을 잘라 붙여 주석을 보존 |

### 9.1 "사용자는 이미 Node를 갖고 있다" 는 틀렸다 (0.7.3)

v0.1의 런타임 결정 근거는 "대상 사용자가 이미 Node를 갖고 있다(`npx`)" 였다.
근거는 Claude Code가 npm으로 설치된다는 것이었는데, 실제로는 네이티브 설치본이 있고
이 프로젝트 사용자 본인의 노트북이 `installMethod: native` — Node가 없어 lshed를 못 쓰는 상태였다.

대응은 두 가지다. 배포 방식을 늘리는 것이지 런타임을 바꾸는 것이 아니다.

- **의존성을 번들에 넣는다.** `dist/cli.js` 하나에 commander·yaml·zod·@clack/prompts·smol-toml 이 들어간다(0.7.3 에 627KB, 0.17.5 에 약 690KB).
  npm 설치가 가벼워지고(zod만 7.9MB였다), 실행파일로 묶기도 쉬워진다.
  대신 ESM 출력에 `require` 셔임이 필요하고, 버전은 빌드 시점에 박는다(실행파일 안에는 package.json이 없다).
- **단일 실행파일.** `bun build --compile` 이 한 대에서 5개 플랫폼을 교차 컴파일한다. 태그를 밀면 릴리스에 붙는다.
  런타임이 통째로 들어가 60~85MB다. 번들 1MB 도 안 되는 도구치고 크지만, Node를 못 깔거나 안 깔 사람에게는 이것뿐이다.
  코드 서명은 하지 않는다(macOS 공증·Windows 인증서는 비용과 절차가 따로다). 첫 실행 경고를 문서에 적는다.

**하지 않은 것:** Homebrew·Scoop·winget·apt. 전부 위 실행파일이 먼저 있어야 가능하고,
그다음은 각 저장소의 등재 절차(인지도 요건, 매니페스트 PR)라 도구의 문제가 아니다.
수요가 확인되면 Scoop 버킷과 Homebrew tap이 가장 싸다.

> `npm` 은 여전히 기본 경로다. Node가 있으면 번들 하나(1MB 미만)만 받고 자동 갱신도 된다.

---

## 10. 검증 전략

홈 디렉터리를 덮어쓰는 도구이므로 단위 테스트보다 **통합 테스트**가 중요하다.

1. 임시 디렉터리에 가짜 `~/.claude`를 만든다 (어댑터 루트를 주입 가능하게 설계).
2. `init` → 매니페스트가 실제 파일과 일치하는지.
3. `restore A` → `restore B` → A에만 있던 부품이 사라지고 사용자 파일은 남는지.
4. `restore --dry-run` 이 아무것도 쓰지 않는지.
5. 기존 `CLAUDE.md`가 있을 때 백업이 생기는지.

---

### 10.1 다른 OS 검증 절차 (0.7.1)

세 층으로 본다. 각 층은 이전 층이 통과해야 의미가 있다.

1. **단위·통합 테스트** — `npm ci && npm test`. CI 매트릭스(ubuntu/macos/windows × node 20/22)가 push 마다 돌린다. Windows 는 심볼릭 링크 대신 junction 을 쓴다.
2. **CLI 스모크** — `npm run build && npm run smoke`. 임시 디렉터리의 가짜 루트에서 빌드된 `dist/cli.js` 를 init → restore → add → diff → save → 전환 → list → sync 순으로 돌린다. 실제 `~/.claude` 는 건드리지 않는다. 셸 spawn, 경로 구분자, `${HOME}`, 파일 rename 같은 플랫폼 차이는 여기서 드러난다.
3. **실환경** — `npm link` 뒤 `lshed init --shed <임시 창고>` 로 실제 루트를 읽기만 하고(init 은 창고와 `<root>/lshed/` 에만 쓴다), `lshed restore --dry-run` 이 전부 `=` 인지 본다. 그다음에야 진짜 창고를 clone 해 `restore` 한다. 백업이 기본이라 되돌릴 수 있다.

Windows 에서 알려진 차이: 홈이 `C:\Users\me`, Claude Code 루트는 `%USERPROFILE%\.claude`, `claude` 는 `claude.cmd`, `install:` 은 cmd.exe 로 실행되므로 `./setup` 같은 sh 스크립트는 못 돈다(Git Bash 경로를 적거나 exclude).

**실제로 CI 가 잡아낸 것 (0.7.4)** — 셋 다 "리눅스에서만 성립하는 경로 비교" 였다.
`fs.realpath` 는 끊어진 링크의 목적지를 풀지 못하는데, macOS 의 임시 디렉터리는 `/var` → `/private/var` 라
풀지 않은 목적지가 패키지의 실제 경로와 영영 안 맞았다. Windows 는 `\\?\` 접두사와 대소문자,
그리고 JSON 안에서 이스케이프된 백슬래시가 문제였다.
경로 비교는 `fsutil.ts` 의 `normalizePath`/`isInside`/`realpathish` 한 곳으로 모았고,
링크된 디렉터리를 만들어 리눅스에서도 이 부류를 재현하는 회귀 테스트를 두었다.

### 10.2 다른 에이전트 검증: probe

> 도구별 버전·결과·실행 날짜는 `docs/VERIFICATION.md` 가 기준이다. 실행 절차(런북)는 `scripts/vm/README.md`.

`--agent codex|gemini|copilot|cursor|agy|agents` 는 각 도구의 문서를 보고 만들었으므로, 도구 자체로 확인하는 층이 하나 더 필요하다. `scripts/vm/probe.sh` 가 그 층이다. 일회용 VM(`install-tools.sh` 로 굽고 `cloud-init.yaml` 로 부팅), 로컬 컨테이너(`Dockerfile.probe` + `probe-docker.sh`, 2026-09-18), 스크래치 `HOME` 을 둔 이 기기, 주간 GitHub 워크플로(`probe.yml`) 어디서든 같은 스크립트가 돈다.

probe 한 번은 (1) 임시 창고(암호어가 든 스킬, 코드워드가 든 지침 조각, `${VAR}` 시크릿을 가진 MCP 둘) 를 `restore --agent <tool>` 로 실제 루트에 놓고 파일을 확인하고,
(2) 도구 자체의 파서가 있으면 그것으로도 본다(`codex mcp list`, `gemini mcp list`, `codex debug prompt-input` 은 모델 없이 스킬 루트를 보여 준다),
(3) `codex exec` / `gemini -p` / `copilot -p` / `agent -p --trust` 로 암호어를 물어 실제로 읽는지 보고,
(4) `restore --link` 뒤 창고를 고쳐 다시 물어 링크를 따라가는지 보고,
(5) 빈 프로필로 `restore none` 해 흔적을 지운다. 암호어는 실행마다 난수라 이전 실행의 잔재로 통과할 수 없다.

설계에 남은 것(자세한 경위는 `docs/VERIFICATION.md`, 각 수정은 `CHANGELOG.md`):
- Codex 는 `$CODEX_HOME/skills`(deprecated)와 `~/.agents/skills` 를 둘 다 읽는다 → `codex` 대상은 0.14.0 부터 `~/.agents/skills` 에 놓는다(스펙 `skillsHome`, 카테고리 루트 `../.agents/skills`; `--root` 를 주면 홈은 그 부모라 테스트가 진짜 홈에 쓰지 않는다). `agents` 대상과 스킬 폴더를 공유하므로 둘 중 하나만 쓰라고 README 에 적었다.
- agy 의 전역 스킬은 `~/.gemini/config/skills` 이고 `~/.agents/skills` 는 아니다. 전역 규칙은 `~/.gemini/AGENTS.md` 와 `GEMINI.md` 를 둘 다 읽는다 → 루트 `~/.gemini/config`, 지침 `../AGENTS.md`(Gemini CLI 와 GEMINI.md 를 다투지 않도록), MCP `mcp_config.json`(serverUrl). 루트 위 부품의 백업은 `..` 을 `__` 로.
- 격리된 `CLAUDE_CONFIG_DIR` 에서 `.claude.json` 이 디렉터리 밖에 쓰이던 버그(0.12.1), Claude Code 2.1 이 스스로 만드는 `~/.claude/skills/synced` 를 스캔에서 제외(0.17.5), Cursor 의 `agent -p` 는 `--trust` 가 필요(0.17.5, `check` 도).
- 저추론 모델은 문맥에 있는 지침 코드워드를 스킬 질문에 답하기도 한다 → 스킬 질문은 스킬만 있는 프로필에서, 질문마다 최대 3회(120초). 도구 호출은 `setsid` 로 터미널에서 떼고 stdin 을 닫는다. 가짜 MCP 서버는 닫힌 로컬 포트(127.0.0.1:9)를 가리킨다.
- Codex 의 읽기 전용 샌드박스는 user namespace 를 못 만드는 호스트에서 스킬 파일을 못 연다 → probe 는 일회용 기기 전제로 `--sandbox danger-full-access`.
- 컨테이너를 "새 기기" 로 삼은 종단 테스트(agent-box `test-fresh`)가 bootstrap 이 에이전트별 state 경로를 알아야 하는 문제를 드러냄 → `restore --fresh-only`, `--agent installed`(0.17.5).

### 10.3 전수 테스트 (2026-09-08, 0.14.1)

§10.1 의 세 층에 probe 를 더한 넷을 코드 변경 없이 전부 돌린 기록(단위·스모크·실행파일 스모크·실제 창고에 대한 claude-code/codex/agy `status`·`diff`·`restore --dry-run`·`add`·`sync --dry-run`, `--pick` pty, Codex·agy probe). 전부 통과했고, 여기서 나온 **문제 둘**(CI Windows 잡의 sync 테스트 타임아웃 플레이크, `update --dry-run` 이 업스트림을 안 봄)은 §11 에 적었다(둘 다 같은 날 해결, 0.14.2). 이후의 실행 기록은 `docs/VERIFICATION.md`.

## 11. 미결 질문

- ~~**CI Windows 잡의 sync 테스트 타임아웃**~~ — **해결 (2026-09-08).** `test/sync.test.ts` 는 테스트마다 git 을 10회 안팎 띄우는데 Windows 러너에선 한 번에 수백 ms 라 vitest 기본 5초가 빠듯했다(코드 결함이 아니라 플레이크). `describe` 와 beforeEach/afterEach 에 30초, afterEach 의 `fs.rm` 에 `maxRetries: 3, retryDelay: 200` 으로 타임아웃 뒤의 EBUSY 를 흡수. 테스트만 바뀌었다.
- ~~**`update --dry-run` 이 업스트림을 확인하지 않는다**~~ — **해결 (2026-09-08, 0.14.2).** `updatePackages` 가 dryRun 이면 조회 없이 `~ package X (… update)` 만 찍었다. 설치기 인터페이스에 선택적 `upstream(ctx, pkg) → { current, latest }` 를 두고, git 설치기는 `git ls-remote`(출처 브랜치·태그; `refs/heads/<ref>`, `refs/tags/<ref>^{}`, `refs/tags/<ref>` 를 명시해 주석 태그는 커밋으로, 같은 이름은 브랜치 우선) 와 clone 의 HEAD 를, 마켓플레이스 설치기는 `installLocation` 이 git 저장소일 때만 그 origin 과 견준다. 플러그인과 공식 마켓플레이스(.gcs-sha 배포, 저장소 아님)는 미리 알 수 없어 `?`. 플러그인 버전은 마켓 커밋 sha 이기도 하고 semver 이기도 해서(installed_plugins.json) Claude Code 의 판정을 흉내내지 않기로 했다 — §7.3 사양 변경에 약하다. 조회 실패는 그 줄에서 `?` 로 알리고 다음으로 넘어간다. 실제 창고에서 `~ gstack 0d1bd56 → 0530392`, `= llm-guidelines`, 나머지 `?` 가 1.3초.
- ~~**비ASCII 이름의 부품이 매니페스트에서 거부된다**~~ — **해결 (2026-09-08).** `init`/`add` 는 `skills/논문리뷰` 를 그대로 적는데 `ID_RE` 가 `\w` 라 검증에서 걸려 이후 모든 명령이 죽었다. 에이전트는 디렉터리 이름을 그대로 읽으므로 id·프로필 이름 규칙을 `\p{L}\p{N}_.-` 로 넓혔고, 스캔한 이름은 NFC 로 정규화해 id 로 쓴다(macOS 가 NFD 를 돌려줘도 창고의 바이트는 같도록). 스모크에 한글 스킬을 넣어 macOS/Windows CI 에서도 본다. 같은 날 `restore --yes` 가 이미 있는 패키지의 `install:` 을 건너뛰던 것도 고쳤다(첫 restore 의 "rerun with --yes" 안내가 거짓이었다).

- ~~**다른 에이전트 어댑터**~~ — **해결 (2026-09-04, 0.11.0).** Codex·Gemini CLI·Copilot CLI·Cursor 가 전부 Agent Skills 표준(`<root>/skills/<name>/SKILL.md`)을 쓰고 공용 `~/.agents/skills/` 도 읽으므로, 도구별 어댑터 대신 `SkillsDirAdapter` 하나에 루트·지침 파일만 다른 스펙 5개(codex/gemini/copilot/cursor/agents)를 넣었다(0.13.0 에서 agy 가 더해져 지금은 6개, §4.6). 창고는 하나이고 `--agent` 로 배치 대상을 고른다(`$LSHED_AGENT`, 창고의 `agent:` 는 기본값). 매니페스트 검증은 현재 어댑터가 아니라 **창고를 만든 에이전트** 기준이라 다른 에이전트로 열어도 오류가 아니며, 모르는 카테고리(mcp, settings, agents, instructions 없음)와 설치기 없는 패키지(claude-plugin:)는 알리고 건너뛴다. state 는 에이전트 루트마다 따로. 지침은 Codex/Gemini/Copilot 모두 이어붙임(Codex 는 import 문법이 없고, Gemini 는 @import 의 허용 디렉터리가 문서에 불명확, Copilot 은 저장소 안에서만). Cursor·~/.agents 는 사용자 지침 파일이 없어 `instructionsFileName()` 이 null. 실환경: 사용자의 `~/.agents/skills` 에 `skills` CLI 로 설치한 5개가 이미 있고 창고와 내용이 같아 dry-run 이 `=` 5, `+` 1(add-drivers) 로 나왔다. MCP 는 0.12.0 에서 추가: 창고 형식은 Claude Code 것 그대로 두고 `adapters/mcp-forms.ts` 가 도구별로 바꾼다(gemini: type 없음·httpUrl, copilot: type local·tools, cursor: `${env:VAR}`·`${userHome}`, codex: env_vars·bearer_token_env_var·env_http_headers 로 변수 *이름*을 적음). 변환은 어댑터의 read/write 안에서만 일어나 core 는 모른다. Codex 의 config.toml 은 `TomlEntries` 가 `[mcp_servers.<id>]` 표 블록만 잘라 붙여 주석·다른 표를 보존(smol-toml 은 읽기와 블록 생성에만). expandsEnv 는 codex·cursor true(이름으로 표현), gemini·copilot false(restore 가 채움). 이름이 다른 자리표시자(env.K = "${OTHER}")는 Codex 로 표현할 수 없어 문자열 그대로 남는다.
- ~~**프로필 상속** (`extends: base`)~~ — **해결 (2026-09-04, 0.9.0).** `extends: base` 또는 `extends: [a, b]`. 부모를 먼저 풀고 자기 것을 뒤에 붙이며 중복은 한 번, 빼기는 없다(덜 원하면 상속하지 말고 나열). 지침은 순서가 의미라 부모 조각이 먼저 import 된다. 없는 부모·순환은 lshed.yaml 참조 오류. 프로필을 읽는 곳(restore 계획, 패키지, list 의 사용처, add 힌트, `--pick` 기준 체크)은 전부 해석된 프로필을 쓴다. `--pick` 이 기기별 프로필을 만들기 시작하면서 "공통 + 기기 차이" 표현이 필요해져 도입.
- ~~**`agents/`·`commands/`의 하위 디렉터리**~~ — **해결 (2026-09-03, 0.7.6).** 문서 기준: `agents/` 는 하위 디렉터리를 **재귀적으로 읽고**, 이름은 경로가 아니라 frontmatter `name` 에서 온다. `commands/` 는 문서가 침묵. 스킬은 사용자 루트에서 `skills/<name>/SKILL.md` 한 단계다.
  lshed 는 최상위 `.md` 만 스캔했으므로 폴더로 정리한 에이전트가 창고에서 조용히 빠졌다. 파일형 카테고리를 재귀 스캔하고 id 에 경로를 그대로 담는다(`team/reviewer`).
  lshed 의 일은 파일을 있는 자리 그대로 옮기는 것이지 재배치가 아니다 — 평탄화하면 사용자의 정리가 사라지고 id 충돌이 생긴다. commands 도 같은 규칙으로 옮긴다: Claude Code 가 안 읽더라도 원래 기기에 있던 그대로다.
- ~~**`CLAUDE.md` import 경로**~~ — **해결 (2026-09-03).** 생성 파일의 `@lshed/instructions/main.md` 는 CLAUDE.md 가 있는 디렉터리 기준으로 풀린다.
  실제 바이너리로 검증: 조각에 암호어를 두고 `claude -p` 로 물으니 직접 적은 대조군과 import 경유 암호어가 둘 다 돌아왔다.
  (사용자 레벨 `CLAUDE_CONFIG_DIR` 로 격리하면 로그인까지 옮겨가 자격 증명을 복사해야 하므로, 같은 import 파서를 쓰는 프로젝트 CLAUDE.md 로 대신 검증했다.)
  상대 경로라 홈이 달라도 그대로 옮겨진다. 절대 경로·`~` 표기는 필요 없다.

---

## 12. 다음 단계

**이름** — 완료 항목 정리
- [x] npm `lshed` 선점 (0.0.0, 2026-08-31)
- [x] `which lshed` 충돌 없음 (2026-09-02)
- [x] GitHub `LeeSongHeon-LSH/lshed` 저장소 생성 — 2026-09-02 (구현 목록의 첫 커밋·v0.1.0 릴리스와 같은 날)

**설계**
- [x] v0.1 스코프 확정 (§8)
- [x] 매니페스트 스키마 초안 (§3.2)
- [x] 상태 모델·소유권 규칙 (§3.4, §3.5)
- [x] `init` 스캔 규칙 상세 (숨김 파일, 심볼릭 링크, 플러그인 캐시 제외) — 0.1.1 무시 목록·링크 따라가기, 0.2.0 패키지·생성물 분류, 0.7.6 재귀 스캔
- [x] `ClaudeCodeAdapter` 경로 표 확정 (agents/commands 하위 디렉터리 포함) — 0.7.6, §11

**구현**
- [x] 프로젝트 스캐폴딩 (§9 스택) — 2026-09-02
- [x] 매니페스트 스키마 + 검증 (`src/manifest.ts`, `src/source.ts`) — 2026-09-02
- [x] 어댑터 + 파일 리졸버 — 2026-09-02
- [x] init / restore / status / diff / save — 2026-09-02
- [x] 통합 테스트 (§10) — `test/integration.test.ts`, 임시 루트 주입
- [x] README 초안 — 2026-09-02
- [x] npm `lshed@0.1.0` 발행 — 2026-09-02
- [x] GitHub 저장소 생성 + 첫 커밋 + v0.1.0 릴리스 — 2026-09-02
- [x] 실환경 도그푸딩: 스킬 62개 → 창고 6.2MB (§14)
- [x] 0.1.1 도그푸딩 수정 (무시 목록·심볼릭 링크) — 2026-09-02
- [x] 0.2.0 패키지·락·update — 2026-09-02
- [x] 실환경 재적용: 부품 6개 + 패키지 1개, 창고 192KB
- [x] 새 기기 시뮬레이션: 빈 루트 + 실제 창고 → 부품 6개 배치, gstack 락 커밋 clone, install 은 표시만 (10.7초)
- [x] 0.2.1 list / remove / prune — 2026-09-02
- [x] 0.3.0 플러그인 설치기 — 2026-09-02
- [x] 0.4.0 MCP 항목형 부품 + ${VAR} 마스킹 — 2026-09-03 (실제 Claude Code 가 사용자 범위에서 확장하는지 프로브로 검증)
- [x] npm 발행 — 0.4.0 은 2026-09-03 부터 릴리스마다 사용자가 수동 발행(일부 버전은 건너뜀), latest 는 0.17.5; GitHub 릴리스는 v0.17.5(2026-09-18)까지 실행파일 5종 게시
- [x] 0.5.0 `lshed add` — init 의 분류(discover)·수집(ingest)을 공용화해 증분으로. `exclude:` 를 매니페스트에 기록 — 2026-09-03
- [x] 0.6.0 `lshed sync` + README 사용 안내 개정 — 2026-09-03
- [x] 0.7.0 settings 항목형 + ${HOME} + 시크릿 단어 단위 — 2026-09-03
- [x] 0.7.3 의존성 번들 + 단일 실행파일 5종 + 릴리스 워크플로 — 2026-09-03
- [x] 0.7.4~0.7.6 macOS/Windows 경로 수정, 결정적 매니페스트 순서, agents/commands 재귀 — 2026-09-03 (CI ubuntu/macos/windows × node 20/22 초록)
- [x] 0.8.0 `restore --pick` 카테고리별 체크리스트 → 프로필 저장 — 2026-09-04
- [x] 0.9.0 프로필 `extends` — 2026-09-04
- [x] 0.10.0 `restore --link` 기기별 링크 배치 (Windows junction·파일 복사 폴백) — 2026-09-04
- [x] 0.11.0 `--agent codex|gemini|copilot|cursor|agents` 공통 SkillsDirAdapter — 2026-09-04
- [x] 0.12.0 타 도구 MCP 형식 변환 (Codex config.toml 표 편집) — 2026-09-04
- [x] 0.12.1 VM probe (`scripts/vm/`) + CLAUDE_CONFIG_DIR 아래 `.claude.json` 위치 수정 — 2026-09-05
- [x] 0.13.0 `--agent agy` (Antigravity) — 2026-09-05, README 영어/한국어 병기
- [x] 2026-09-08 전수 테스트 (§10.3): 단위·스모크·바이너리·`--pick` pty·실환경 dry-run·Codex/agy probe 전부 통과, 코드 변경 없음
- [x] CI Windows 잡의 sync 테스트 타임아웃 여유 (§11) — 2026-09-08, 테스트만
- [x] `update --dry-run` 이 업스트림을 확인하도록 (§11) — 2026-09-08, 0.14.2
- [x] Gemini CLI·Cursor probe, 모델 질문까지 (§10.2) — 2026-09-18, VM 대신 로컬 컨테이너
- [ ] Copilot CLI probe 의 모델 질문 — COPILOT_GITHUB_TOKEN 대기 (배치·형식은 통과)
- [x] 사용자 실제 Windows 노트북에서 §10.1 3층 (실행파일로 restore --dry-run, --link 의 junction·복사 폴백) — 0.15.1~0.17.3, `docs/VERIFICATION.md`
- [x] 실제 창고 ~/harness 를 `--agent agy`·`--agent codex` 로 이 기기에 적용 (도그푸딩, `tools` 프로필 + --link) — 2026-09-05. 잡은 것: 한 플러그인짜리 마켓플레이스의 id 충돌, `extraKnownMarketplaces` 를 후보로 잡던 것, Antigravity 의 빈 mcp_config.json 을 못 읽던 것 (0.14.1)

---

## 13. 개정 요지 (2026-09-02)

초안(`notes/overview.v0.1-draft.md`, 작성자의 비공개 로컬 노트로 저장소에는 없다) 대비 바뀐 것.

| 항목 | 초안 | 개정 | 이유 |
|---|---|---|---|
| 차별점 | 시크릿 포함이 핵심 | 프로필·관리 집합·출처 참조가 핵심 | 시크릿은 v0.2에도 dotfiles와 동급. 논리 모순 제거 |
| dotfiles 비교 | "선택 설치 불가" | "가능하지만 하네스 단위가 아님" | Stow·chezmoi에 반박당함 |
| 저장소 백엔드 | `StorageBackend` 인터페이스 | 없음. 창고 = 디렉터리 | 불필요한 추상화 |
| 락파일 | v0.1 | v0.2 (패키지와 함께, §6.3) | `file:`만 있으면 잠글 게 없음 |
| 프로필 복수 | v0.2 | v0.1 | 창고/레시피 분리의 전제 |
| 스캐폴드 | v0.3 | 범위 밖 | 하네스 휴대와 무관 |
| 관리 대상 | skills/mcp/instructions/scaffolds | 어댑터 정의. v0.1은 skills/agents/commands/instructions | 실제 `~/.claude` 구조 반영 |
| 지침 병합 | 이어붙이기 | `@import` 목록 생성 | 병합 문제 자체가 소멸 |
| `save` 방향 | 미정 | 창고가 진실, `file:`만 save | 양방향 동기화 회피 |
| 상태 모델 | 없음 | 관리 집합 + state.json | 안전한 프로필 전환의 전제 |
| `update` 명령 | 없음 | v0.2 | "업스트림 갱신"을 문제로 꼽고 명령이 없었음 |
| 배치 방식 | 미정 | 복사, 기기별 `--link` (0.10.0) | 크로스 플랫폼·검증 부담 |
| 범위 | 미정 | 사용자 레벨만 | 프로젝트 레벨은 git이 이미 해결 |
| 기술 스택·테스트 | 없음 | §9, §10 | 구현 착수 전 필수 |
| 비용·수익·연구·폐기 대안 | 본문 | `notes/background.md` (비공개 로컬 노트) | 설계 문서 성격 분리 |

---

## 14. 실환경 도그푸딩 (2026-09-02)

제작자 본인의 `~/.claude`(스킬 62개)에 v0.1.0을 그대로 적용해 본 결과.

### 발견된 결함 두 가지 (v0.1.1에서 수정)

| 문제 | 증상 | 원인 | 조치 |
|---|---|---|---|
| 재생성 가능한 디렉터리 복사 | 창고가 1.6GB. 실제 내용은 6.2MB | `node_modules` 947MB, `.git` 127MB를 그대로 복사 | 무시 목록 도입. 복사·해시·diff·백업이 공유 |
| 심볼릭 링크 부품 누락 | 스킬 하나가 조용히 사라짐 | `Dirent`는 링크를 파일로도 디렉터리로도 보지 않음 | `stat`으로 판정, 복사 시 dereference |

두 번째가 특히 위험했다. **오류 없이 조용히 빠졌다.** 실환경에 돌려보지 않았으면 몇 달 뒤에야 알았을 문제다.

### 설계 판단

- **`dist`는 기본 무시 대상이 아니다.** 어떤 스킬은 `dist`가 곧 실행 대상이다. 기본값으로 빼면 restore된 스킬이 조용히 동작하지 않는다. 무시하려면 매니페스트의 `ignore:`로 사용자가 명시한다.
- **모든 스킬이 휴대 대상은 아니다.** 자체 설치 관리자와 벤더링된 바이너리 457MB를 가진 툴킷은 창고에 담는 것보다 각 환경에서 재설치하는 편이 맞다. `init --exclude`로 뺀다.
  이는 v0.2의 원격 출처가 풀어야 할 문제의 실제 사례였고, 0.2.0 의 패키지(§3.7)가 답이 되었다.

### 결과

```
스킬 62개 → 61개 담김 (툴킷 1개 --exclude), 창고 6.2MB, 파일 336개, 소요 0.12초
restore --dry-run  →  변경 없음 (창고와 로컬이 일치)
status             →  드리프트 없음
```

시크릿 스캔 결과 실제 자격증명은 없다. 탐지된 세 건은 전부 오탐으로,
보안 스캐너 스킬이 문서에 적어둔 탐지 패턴과 공식 문서용 예시 키였다.

### 2차 도그푸딩: 61개 중 진짜는 6개였다

1차에서 "담긴 61개"를 다시 보니 55개가 `gstack`의 `./setup`이 생성한 스텁이었다.
SKILL.md 하나와 `bin` 심볼릭 링크(절대 경로로 gstack 안을 가리킴)로 되어 있고, gstack 문서에 "재생성되므로 수정해도 날아간다"고 적혀 있다.
다른 기기에 복원하면 55개가 전부 깨진 채 나타나고, 거기에 gstack을 설치하면 setup이 덮어써 관리 집합과 어긋난다.

§2.2에서 "npm 없이 node_modules를 git에 넣는 것"이라고 비판해 놓고 lshed가 정확히 그 짓을 한 셈이다.
여기서 §3.7의 세 종류 구분이 나왔다.

```
2차 결과: 부품 6개 복사, 패키지 1개 참조(gstack @253d1df), 생성물 53개 건너뜀, 별칭 2개 --exclude
창고 192KB (1차 6.2MB, 원본 1.6GB)
```

휴리스틱의 한계도 드러났다. gstack setup은 별칭 디렉터리 두 개(`_gstack-command`, `connect-chrome`)를
"심볼릭 링크를 쓰지 않는다"고 명시하고 만든다. 링크 기반 감지로는 잡을 수 없어 `--exclude`로 뺐다.
설치 관리자의 관례는 제각각이라, 감지는 제안이고 확정은 사용자가 한다는 원칙이 맞다.
