# lshed

Keep your coding-agent harness — skills, subagents, commands, instructions, MCP servers, settings — in a **shed**, and restore it on any machine with one command.

코딩 에이전트의 하네스(스킬, 서브에이전트, 명령, 지침, MCP 서버, 설정)를 **창고(shed)** 에 두고, 어느 기기에서든 명령 하나로 되살립니다.

```
lshed init --shed ~/lshed          # scan ~/.claude into a shed + write lshed.yaml
lshed restore research             # apply a profile anywhere
```

The shed is a plain directory. Put it in a git repo, Dropbox, whatever. `lshed sync` wraps the git part if you want it to. Works with Claude Code, and places the same shed into Codex, Gemini CLI, Copilot CLI, Cursor, Google Antigravity and the shared `~/.agents/skills`.

창고는 그냥 디렉터리입니다. git 저장소에 두든 Dropbox에 두든 상관없고, git 부분은 `lshed sync`가 대신해 줍니다. Claude Code 기준으로 만들었지만 같은 창고를 Codex, Gemini CLI, Copilot CLI, Cursor, Google Antigravity, 공용 `~/.agents/skills`에도 놓을 수 있습니다.

> This README says everything twice: English first, then 한국어. Code blocks and tables are shared.
> 이 문서는 모든 설명을 영어 다음 한국어 순서로 두 번 적습니다. 코드 블록과 표는 하나를 같이 봅니다.

## Why · 왜 필요한가

Every new laptop, server, container or WSL box means setting up `~/.claude` again. The obvious fix is to put `~/.claude` itself in git, and for many people that is the right answer.

새 노트북, 서버, 컨테이너, WSL을 하나 늘릴 때마다 `~/.claude`를 다시 꾸며야 합니다. 가장 뻔한 해법은 `~/.claude` 자체를 git에 넣는 것이고, 많은 사람에게는 그것이 정답입니다.

**When a plain git repository is enough.** You are one person, every machine gets the same setup, and everything in `~/.claude` is yours. Then make `~/.claude` itself a git repository and you should not install lshed. Git does the moving; the `.gitignore` only keeps machine state (sessions, caches) out of it:

**`~/.claude`를 그냥 git 저장소로 두면 충분한 경우.** 혼자 쓰고, 모든 기기가 같은 구성이며, `~/.claude` 안의 것이 전부 직접 만든 것이라면 `~/.claude` 자체를 git 저장소로 만들면 끝나고, lshed를 설치할 이유가 없습니다. 옮기는 것은 git이고, `.gitignore`는 세션 기록·캐시 같은 기기 상태값을 저장소에서 빼는 제외 목록일 뿐입니다.

```
cd ~/.claude && git init
printf 'projects/\ncache/\nsessions/\nshell-snapshots/\nhistory.jsonl\n*.bak*\n' > .gitignore
git add skills agents commands CLAUDE.md settings.json .gitignore && git commit -m init
```

No new concepts, no copy step: the directory you edit is the repository. `git push` here and `git clone <remote> ~/.claude` on the next machine is the whole restore.

새로 배울 개념도, 복사 단계도 없습니다. 편집하는 디렉터리가 곧 저장소이고, 여기서 `git push`한 뒤 다음 기기에서 `git clone <원격> ~/.claude`하는 것이 곧 복원입니다.

**Where that stops working.** The repository above starts to hurt as soon as `~/.claude` is not just yours:

**그것이 막히는 지점.** `~/.claude`가 "내가 쓴 것"만이 아니게 되는 순간 위 저장소는 아프기 시작합니다.

- **Toolkits you installed.** One cloned toolkit here is 1.6 GB and generated 53 alias skills next to the 4 you wrote. Raw git commits all of it, or you maintain the ignore list by hand.
  **설치한 툴킷.** 툴킷 하나가 1.6 GB짜리 clone이고, 직접 쓴 스킬 4개 옆에 별칭 스킬 53개를 만들어 놓습니다. 날것의 git은 이것을 전부 커밋하거나, 아니면 ignore 목록을 손으로 관리해야 합니다.
- **Secrets inside one JSON file.** MCP servers and their tokens live in `~/.claude.json` together with unrelated state. File-level ignore cannot split them, so you either commit tokens or leave MCP out.
  **JSON 파일 하나 안의 시크릿.** MCP 서버와 토큰이 `~/.claude.json` 안에 무관한 상태값과 함께 있습니다. 파일 단위 ignore로는 가를 수 없어, 토큰을 커밋하거나 MCP를 포기해야 합니다.
- **A machine that already has a setup.** `git clone` into a non-empty `~/.claude` is a merge you do by hand, and nothing tracks which files came from the repo and which were already there.
  **이미 설정이 있는 기기.** 비어 있지 않은 `~/.claude`에 `git clone`하는 것은 손으로 하는 병합이고, 어떤 파일이 저장소에서 왔고 어떤 것이 원래 있던 것인지 아무도 기억하지 않습니다.
- **Different subsets per machine.** A headless server wants no browser toolkit and no MCP. Branches or templates can fake this, but nothing removes the parts you no longer want when you switch.
  **기기마다 다른 부분집합.** 헤드리스 서버에는 브라우저 툴킷도 MCP도 필요 없습니다. 브랜치나 템플릿으로 흉내낼 수는 있지만, 구성을 바꿀 때 더 이상 원치 않는 부품을 치워 주는 것은 없습니다.
- **Choosing on the machine itself.** `git clone` is all or nothing. On a new box you want to look at what the shed has, category by category, and tick what this machine needs.
  **기기에서 직접 고르기.** `git clone`은 전부 아니면 전무입니다. 새 기기에서는 창고에 뭐가 있는지 카테고리별로 보고, 이 기기에 필요한 것만 체크하고 싶습니다.

lshed exists for those five cases. It keeps the shed as a plain directory in git, and adds three ideas on top:

lshed는 이 다섯 경우를 위해 있습니다. 창고는 여전히 git 안의 평범한 디렉터리이고, 그 위에 개념 셋을 얹습니다.

| Idea · 개념 | What it gives you · 얻는 것 |
|---|---|
| **Components** · 부품 | every skill / agent / command / instruction fragment / MCP server / settings key is one named part; toolkits you installed are recorded as a source and version, not copied. 스킬·에이전트·명령·지침 조각·MCP 서버·설정 키 하나하나가 이름 있는 부품입니다. 설치한 툴킷은 복사하지 않고 출처와 버전만 기록합니다. |
| **Profiles** · 프로필 | named recipes — `research`, `work`, `minimal` — that pick a subset of parts; write them in `lshed.yaml`, or let `restore --pick` build one from a checklist. `research`, `work`, `minimal`처럼 이름 붙인 조합입니다. `lshed.yaml`에 적거나, `restore --pick`의 체크리스트로 만듭니다. |
| **Managed set** · 관리 집합 | lshed remembers what it placed, so switching profiles or restoring onto an existing machine removes only its own files and never touches yours. lshed는 자기가 놓은 것을 기억하므로, 프로필을 바꾸거나 기존 기기에 복원해도 자기 파일만 치우고 여러분의 파일은 건드리지 않습니다. |

The trade: you edit in `~/.claude` and run `lshed save` to copy changes into the shed (or use `restore --link` on machines where you edit a lot, and skip the copy step), and lshed has to know each agent's layout, which the plain repository does not. If none of the five cases applies to you, the plain repository wins.

대가도 있습니다. 편집은 `~/.claude`에서 하고 `lshed save`로 창고에 복사해야 하며(많이 편집하는 기기에서는 `restore --link`로 복사 단계를 없앨 수 있습니다), lshed는 각 에이전트의 파일 배치를 알아야 합니다. 다섯 경우 중 하나도 해당하지 않으면 그냥 git 저장소가 낫습니다.

## Install · 설치

With Node 20 or newer:

Node 20 이상이 있으면:

```
npm install -g lshed          # or run it once: npx lshed status
```

Without Node, download a standalone binary from the [latest release](https://github.com/LeeSongHeon-LSH/lshed/releases/latest) and put it on your PATH. It carries its own runtime, so it is ~80 MB.

Node가 없으면 [최신 릴리스](https://github.com/LeeSongHeon-LSH/lshed/releases/latest)에서 단독 실행파일을 받아 PATH에 두세요. 런타임을 품고 있어 80 MB쯤 됩니다.

| Platform · 플랫폼 | File · 파일 |
|---|---|
| Windows x64 | `lshed-windows-x64.exe` → rename to `lshed.exe` |
| macOS Apple Silicon / Intel | `lshed-darwin-arm64` / `lshed-darwin-x64` |
| Linux x64 / arm64 | `lshed-linux-x64` / `lshed-linux-arm64` |

On macOS and Linux, `chmod +x` it first. The binaries are unsigned, so macOS warns on first run. Either way you also need `git` on the PATH for packages and `sync`, and `claude` if your shed lists plugins.

macOS와 Linux에서는 먼저 `chmod +x`가 필요합니다. 서명하지 않았으므로 macOS는 첫 실행에서 경고합니다. 어느 쪽이든 패키지와 `sync`에는 PATH의 `git`이, 창고에 플러그인이 있으면 `claude`가 필요합니다.

## Quick start · 빠른 시작

```bash
# 1. On the machine that already has your setup  ·  이미 설정이 있는 기기에서
lshed init --shed ~/lshed
cd ~/lshed && git init && git remote add origin <your private repo>
lshed sync                                  # commit + push

# 2. Edit ~/lshed/lshed.yaml — add profiles, drop parts you don't need everywhere
#    ~/lshed/lshed.yaml 을 열어 프로필을 만들고, 모든 기기에 필요하지 않은 부품은 빼세요

# 3. On any other machine  ·  다른 기기에서
git clone <your private repo> ~/lshed
lshed restore research --shed ~/lshed       # --shed only needed the first time  ·  --shed 는 처음 한 번만
lshed restore --pick --shed ~/lshed         # or tick what this machine gets, category by category
                                            # 또는 카테고리별로 이 기기에 둘 것을 체크
```

## How to use it · 사용법

### Day one: put what you have into a shed · 첫날: 가진 것을 창고에 담기

```
$ lshed init --shed ~/lshed --exclude _gstack-command connect-chrome
스캔: /home/me/.claude  →  창고: /home/me/lshed
  ≡ package gstack  github:garrytan/gstack@main @253d1df  (참조만 기록)
  ≡ package claude-plugins-official  claude-marketplace:anthropics/claude-plugins-official  (참조만 기록)
  ≡ package exa  claude-plugin:exa@claude-plugins-official @3.4.1  (참조만 기록)
  · skills/browse  (gstack 가 생성한 것 → 건너뜀)
  · skills/review  (gstack 가 생성한 것 → 건너뜀)
  - skills/_gstack-command  (--exclude)
  + skills/add-drivers
  + skills/domain-modeling
  + mcp/notion  (시크릿 → ${NOTION_AUTHORIZATION})
  + instructions/main  (CLAUDE.md)

lshed.yaml 생성: /home/me/lshed/lshed.yaml  (부품 4개, 패키지 3개, 생성물 53개 건너뜀, 제외 2개, 프로필 "default")
```

`init` reads your agent root and writes only to the shed and `~/.claude/lshed/`. It sorts everything into [three kinds](#three-kinds-of-things--세-종류의-것): authored parts are copied (`+`), things you installed become packages recorded by source and version (`≡`), and files an installer generated are skipped (`·`). Aliases an installer created without symlinks look authored; leave them out with `--exclude`, and lshed remembers that under `exclude:` in the manifest.

`init`은 에이전트 루트를 읽기만 하고, 쓰는 곳은 창고와 `~/.claude/lshed/`뿐입니다. 발견한 것을 [세 종류](#three-kinds-of-things--세-종류의-것)로 나눕니다. 직접 만든 것은 복사(`+`), 설치한 것은 출처와 버전만 적은 패키지(`≡`), 설치기가 만든 파일은 건너뜀(`·`)입니다. 설치기가 심볼릭 링크 없이 만든 별칭은 직접 만든 것처럼 보이므로 `--exclude`로 빼세요. 그 선택은 매니페스트의 `exclude:`에 남습니다.

Then open `lshed.yaml`. It has one profile, `default`, listing everything. Fill in `install:` for git packages that need a post-clone step, and make it a git repo:

그다음 `lshed.yaml`을 여세요. 전부를 담은 `default` 프로필 하나가 있습니다. clone 뒤 설치 단계가 필요한 git 패키지에는 `install:`을 적고, 창고를 git 저장소로 만듭니다.

```
cd ~/lshed && git init && git remote add origin git@github.com:me/harness.git
lshed sync
```

### Every day: edit, save, sync · 매일: 편집, 저장, 동기화

You edit skills where the agent reads them, in `~/.claude`. The shed does not change by itself.

스킬은 에이전트가 읽는 자리인 `~/.claude`에서 편집합니다. 창고는 저절로 바뀌지 않습니다.

```
lshed status          # what profile is applied, what drifted, what is new  ·  적용된 프로필, 드리프트, 새로 생긴 것
lshed diff            # file-level differences between ~/.claude and the shed  ·  ~/.claude 와 창고의 파일 차이
lshed save            # copy local edits into the shed (or: lshed save skills/add-drivers)  ·  로컬 편집을 창고로
lshed sync            # commit the shed, pull, push  ·  창고 커밋, pull, push
```

`save` is the only path from `~/.claude` to the shed, and it only works for parts the shed owns (`file:` sources). `sync` warns if you have unsaved edits so you do not push a shed that is behind your machine.

`~/.claude`에서 창고로 가는 길은 `save`뿐이고, 창고가 소유한 부품(`file:` 출처)에만 동작합니다. `sync`는 저장하지 않은 편집이 있으면 경고해서, 기기보다 뒤처진 창고를 push하지 않게 합니다.

### A machine that already has a setup · 이미 설정이 있는 기기

The common case is not an empty machine: it already runs the agent and has skills, settings and MCP servers of its own. `restore` is built for that. With no prior lshed state it **removes nothing** — it places what the profile lists, and anything it overwrites goes to `~/.claude/lshed/backups/<timestamp>/` first. Parts that exist only on that machine are untouched.

빈 기기보다 흔한 것은 이미 에이전트를 쓰고 있어 자기 스킬·설정·MCP 서버가 있는 기기입니다. `restore`는 그 경우를 위해 만들어졌습니다. 이전 lshed 상태가 없으면 **아무것도 지우지 않습니다.** 프로필이 적은 것을 놓고, 덮어쓰는 것은 먼저 `~/.claude/lshed/backups/<시각>/`에 백업합니다. 그 기기에만 있는 부품은 그대로 둡니다.

```
$ lshed restore default --shed ~/lshed --dry-run
  + skills/mine
  ~ skills/shared            # same name, different content → backed up, then replaced
  + mcp:exa  (${EXA_API_KEY})
  ~ settings:model
(dry-run) 변경 없음. 배치 5, 제거 0, 백업 예정 3
```

Always run `--dry-run` first. `+` is new, `~` replaces with a backup, `-` removes with a backup. If the plan looks right, drop the flag. Then push that machine's own parts up into the shed and both machines have everything:

먼저 `--dry-run`을 돌리세요. `+`는 새로 놓음, `~`는 백업 뒤 교체, `-`는 백업 뒤 제거입니다. 계획이 맞으면 플래그를 빼고 다시 돌립니다. 그다음 그 기기만의 부품을 창고에 올리면 두 기기가 같은 것을 갖게 됩니다.

```
lshed add                    # lists what this machine has that the shed does not  ·  창고에 없는 것을 나열
lshed add windows-only mcp/my-local-server
lshed sync
```

Do not run `init` on such a machine just to look around. `init` claims what it finds as lshed-managed, so a later `restore` from your real shed would treat those parts as removable (backed up, but removed). Use `lshed scan`, which only prints. If you do it anyway, `restore` warns you before removing anything and `lshed add` is the way out.

둘러보려고 그런 기기에서 `init`을 돌리지 마세요. `init`은 찾은 것을 lshed 관리 대상으로 등록하므로, 나중에 진짜 창고로 `restore`하면 그 부품들을 제거 대상으로 봅니다(백업은 되지만 제거됩니다). 출력만 하는 `lshed scan`을 쓰세요. 이미 그랬다면 `restore`가 제거 전에 경고하고, `lshed add`가 빠져나오는 길입니다.

### A new machine · 새 기기

```
git clone git@github.com:me/harness.git ~/lshed
lshed restore default --shed ~/lshed
```

```
  + package gstack  (clone https://github.com/garrytan/gstack.git @main → 253d1df)
  + package claude-plugins-official  (claude plugin marketplace add anthropics/claude-plugins-official)
  + package exa  (claude plugin install exa@claude-plugins-official  (전에 3.4.1; 고정은 안 됨))
  + skills/add-drivers
  + skills/domain-modeling
  + mcp:notion  (${NOTION_AUTHORIZATION})
  + lshed/instructions/main.md
  + CLAUDE.md

프로필 "default" 적용: 배치 5, 제거 0, 패키지 설치 3

설치 명령 1개를 실행하지 않았습니다. 확인 후 '--yes' 로 다시 실행하거나 직접 돌리세요:
  cd /home/me/.claude/skills/gstack && ./setup

환경변수가 없는 항목이 있습니다. 시크릿 값은 창고에 담지 않으므로 이 기기의 셸 환경에 넣으세요 (예: ~/.zshrc 의 export):
  mcp:notion: NOTION_AUTHORIZATION
```

Two things need you afterwards. Package `install:` commands are shell commands from a repository you cloned, so `restore` shows them and stops; run them yourself or rerun with `--yes`. MCP servers reference secrets as `${VAR}`; export the variables in your shell and Claude Code fills them in. From then on `lshed restore` with no arguments reapplies the last profile, and the shed location is remembered.

그 뒤 손이 가는 것은 둘입니다. 패키지의 `install:`은 clone해 온 저장소의 셸 명령이므로 `restore`는 보여 주고 멈춥니다. 직접 돌리거나 `--yes`로 다시 실행하세요. MCP 서버는 시크릿을 `${VAR}`로 참조하니 셸에서 export하면 Claude Code가 채웁니다. 이후로는 인자 없는 `lshed restore`가 마지막 프로필을 다시 적용하고, 창고 위치도 기억합니다.

### Picking instead of naming a profile · 프로필 이름 대신 골라서 넣기

You do not have to know the profile names, or edit `lshed.yaml`, to set up a machine. `restore --pick` walks the shed one category at a time and asks what this machine should get:

기기를 꾸미려고 프로필 이름을 알거나 `lshed.yaml`을 고칠 필요는 없습니다. `restore --pick`은 창고를 카테고리 하나씩 보여 주며 이 기기에 둘 것을 묻습니다.

```
$ lshed restore --pick --shed ~/lshed
창고: /home/me/lshed  (packages (3), skills (4), instructions (1), mcp (1))
◆  packages (3)  — 이 기기에 둘 것을 고르세요 (space 선택, a 전체, enter 다음)
│  ◼ gstack  github:garrytan/gstack@main
│  ◻ claude-plugins-official  claude-marketplace:anthropics/claude-plugins-official
│  ◻ exa  claude-plugin:exa@claude-plugins-official
◆  skills (4)  — 이 기기에 둘 것을 고르세요
│  ◼ add-drivers
│  ◼ domain-modeling
│  ◻ grilling
│  ◻ paper-review
◆  instructions (1)
│  ◼ main
◆  mcp (1)
│  ◻ notion
◆  이 선택을 저장할 프로필 이름
│  lab-box

프로필 "lab-box" 을 lshed.yaml 에 저장했습니다. 다른 기기에서도 쓰려면 lshed sync 로 올리세요.

  + package gstack  (clone https://github.com/garrytan/gstack.git @main → 253d1df)
  + skills/add-drivers
  + skills/domain-modeling
  + lshed/instructions/main.md
  + CLAUDE.md

프로필 "lab-box" 적용: 배치 4, 제거 0, 패키지 설치 1
```

Categories the shed has nothing in (here `agents`, `commands`, `settings`) are skipped, not shown empty. The choice is always saved as a profile, named after the machine unless you type another name: that is what makes the next bare `lshed restore` reapply it, and what `lshed sync` carries to your other machines. If the shed already has a profile with that name, lshed asks before overwriting it.

창고에 아무것도 없는 카테고리(여기서는 `agents`, `commands`, `settings`)는 빈 화면 대신 건너뜁니다. 선택은 반드시 프로필로 저장되며, 이름을 따로 치지 않으면 기기 이름이 됩니다. 그래야 다음 번 인자 없는 `lshed restore`가 같은 것을 다시 적용하고, `lshed sync`가 다른 기기로 실어 나릅니다. 같은 이름의 프로필이 이미 있으면 덮어쓰기 전에 묻습니다.

`lshed restore default --pick` starts with `default`'s parts checked, so you can trim a profile for this machine instead of starting from nothing. With no argument the last applied profile is the starting point. `--dry-run` shows the plan and writes neither `lshed.yaml` nor `~/.claude`. Ctrl+C at any screen leaves everything untouched. On a machine with no applied profile, a bare `lshed restore --shed ~/lshed` in a terminal opens the picker by itself. In a script or a pipe it asks for a profile name instead.

`lshed restore default --pick`은 `default`의 부품이 체크된 채 시작하므로, 빈 손에서 시작하는 대신 이 기기용으로 덜어낼 수 있습니다. 인자가 없으면 마지막 적용 프로필이 출발점입니다. `--dry-run`은 계획만 보여 주고 `lshed.yaml`도 `~/.claude`도 쓰지 않습니다. 어느 화면에서든 Ctrl+C는 아무것도 바꾸지 않습니다. 적용된 프로필이 없는 기기에서 터미널에서 `lshed restore --shed ~/lshed`만 치면 picker가 저절로 열립니다. 스크립트나 파이프에서는 대신 프로필 이름을 요구합니다.

### Profiles · 프로필

A profile is a list of ids per category. Add as many as you like to `lshed.yaml`:

프로필은 카테고리별 id 목록입니다. `lshed.yaml`에 얼마든지 추가하세요.

```yaml
profiles:
  default:
    packages: [gstack, claude-plugins-official, exa]
    skills: [add-drivers, domain-modeling, grilling]
    instructions: [main]
    mcp: [notion]
  server:                       # headless box: no browser toolkit, no MCP  ·  헤드리스 서버: 브라우저 툴킷도 MCP 도 없음
    skills: [add-drivers]
    instructions: [main, server-rules]
```

```
lshed restore server
  - skills/domain-modeling
  - skills/grilling
  - mcp:notion
  = skills/add-drivers
  ~ CLAUDE.md
  + lshed/instructions/server-rules.md
```

Switching removes only what the previous profile placed (`-`), keeps what both use (`=`), and rewrites what changed (`~`). Everything removed or overwritten goes to `~/.claude/lshed/backups/<timestamp>/` first. Packages are additive: a profile that does not list `gstack` leaves the clone alone. `--dry-run` prints this plan without touching anything. Instructions fragments are ordered. `restore` writes a `CLAUDE.md` that `@`-imports each fragment, so editing a fragment in the shed shows up on the next `restore` and there is nothing to merge.

전환은 이전 프로필이 놓은 것만 치우고(`-`), 둘 다 쓰는 것은 두고(`=`), 내용이 바뀐 것만 다시 씁니다(`~`). 치우거나 덮어쓰는 것은 모두 `~/.claude/lshed/backups/<시각>/`에 먼저 갑니다. 패키지는 더하기만 합니다. `gstack`을 적지 않은 프로필도 clone은 그대로 둡니다. `--dry-run`은 이 계획만 출력합니다. 지침 조각은 순서가 있습니다. `restore`는 조각을 `@`-import하는 `CLAUDE.md`를 만들므로, 창고에서 조각을 고치면 다음 `restore`에 반영되고 병합할 것이 없습니다.

A profile can build on another one with `extends`, so a machine-specific profile lists only what is different:

프로필은 `extends`로 다른 프로필 위에 쌓을 수 있어, 기기별 프로필에는 다른 점만 적으면 됩니다.

```yaml
profiles:
  default:
    skills: [add-drivers, domain-modeling]
    instructions: [main]
  laptop:
    extends: default            # everything in default, plus:  ·  default 전부에 더해서
    packages: [gstack]
    mcp: [notion]
  lab:
    extends: [default]          # a list works too, applied in order  ·  목록도 되고, 순서대로 적용
    instructions: [lab-rules]   # comes after default's `main`  ·  default 의 main 뒤에 옴
```

Inheritance only adds. The parent's parts come first, then the profile's own, and instructions keep that order in the generated `CLAUDE.md`. To get *less* than the parent, do not extend it; list what you want. A missing parent or a cycle is reported as a `lshed.yaml` error before anything is touched, and `lshed list` counts a part as used by every profile that inherits it.

상속은 더하기만 합니다. 부모의 부품이 먼저, 자기 것이 뒤에 오고, 지침도 그 순서로 `CLAUDE.md`에 들어갑니다. 부모보다 *적게* 가지려면 상속하지 말고 원하는 것을 직접 적으세요. 없는 부모나 순환은 아무것도 건드리기 전에 `lshed.yaml` 오류로 알리고, `lshed list`는 상속받는 프로필도 그 부품을 쓰는 것으로 셉니다.

### Other agents, same shed · 다른 에이전트도 같은 창고로

Codex, Gemini CLI, Copilot CLI, Cursor and Google Antigravity (`agy`) all read skills from `<their config dir>/skills/<name>/SKILL.md`, the same layout Claude Code uses, and all but Antigravity also read the shared `~/.agents/skills/`. So one shed can serve them all. Pick the target with `--agent`. For Codex, skills go to `~/.agents/skills` because that is the location Codex documents, so use either `--agent codex` or `--agent agents` for skills on one machine, not both:

Codex, Gemini CLI, Copilot CLI, Cursor, Google Antigravity(`agy`)는 모두 `<자기 설정 디렉터리>/skills/<이름>/SKILL.md`를 읽습니다. Claude Code와 같은 배치이고, Antigravity를 뺀 나머지는 공용 `~/.agents/skills/`도 읽습니다. 그래서 창고 하나로 전부를 채울 수 있습니다. 대상은 `--agent`로 고릅니다. Codex의 스킬은 Codex 문서가 정한 위치인 `~/.agents/skills`에 놓으므로, 한 기기에서 스킬은 `--agent codex`와 `--agent agents` 중 하나로만 넣으세요.

```
lshed restore --agent agents            # ~/.agents/skills: every tool that follows the convention reads it  ·  규약을 따르는 모든 도구가 읽는 공용 위치
lshed restore --agent codex             # ~/.agents/skills + ~/.codex/AGENTS.md + config.toml
lshed restore --agent gemini --link     # ~/.gemini/skills + ~/.gemini/GEMINI.md, as links  ·  링크로
lshed restore --agent agy               # ~/.gemini/config/skills + ~/.gemini/AGENTS.md (Antigravity IDE and CLI)
```

| `--agent` | root · 루트 | skills · 스킬 | instructions file · 지침 파일 | MCP servers · MCP 서버 |
|---|---|---|---|---|
| `claude-code` (default) | `~/.claude` or `$CLAUDE_CONFIG_DIR` | yes, plus agents, commands, settings | `CLAUDE.md`, `@`-imports fragments | `~/.claude.json` |
| `codex` | `~/.codex` or `$CODEX_HOME` | yes, in `~/.agents/skills` (Codex's documented location; `~/.codex/skills` is deprecated) | `AGENTS.md`, fragments concatenated | `config.toml` `[mcp_servers.*]` |
| `gemini` | `~/.gemini` | yes | `GEMINI.md`, concatenated | `settings.json` |
| `copilot` | `~/.copilot` or `$COPILOT_HOME` | yes | `copilot-instructions.md`, concatenated | `mcp-config.json` |
| `cursor` | `~/.cursor` | yes | none (Cursor's user rules live in its settings UI) | `mcp.json` |
| `agy` | `~/.gemini/config` | yes | `../AGENTS.md`, concatenated (agy reads `GEMINI.md` too, but Gemini CLI owns that one) | `mcp_config.json` |
| `agents` | `~/.agents` | yes | none | none |

MCP entries are stored in the shed in Claude Code's shape and translated on the way out: Gemini gets `httpUrl` and no `type`, Antigravity gets `serverUrl`, Copilot gets `type: local` and `tools: ["*"]`, Cursor gets `${env:VAR}` placeholders and Codex gets `env_vars` / `bearer_token_env_var` / `env_http_headers` with the variable *names*, so for those two the secret values never touch the config file. Gemini, Antigravity and Copilot do not expand placeholders, so lshed fills them from your shell at `restore`. Codex's `config.toml` is edited table by table; your comments and other settings stay as they are. `lshed init --agent gemini` reads the same files back into the shed shape, secrets masked.

MCP 항목은 창고에 Claude Code 형식으로 두고 나갈 때 바꿉니다. Gemini는 `type` 없이 `httpUrl`, Antigravity는 `serverUrl`, Copilot은 `type: local`과 `tools: ["*"]`, Cursor는 `${env:VAR}` 자리표시자, Codex는 `env_vars` / `bearer_token_env_var` / `env_http_headers`에 변수 *이름*을 적습니다. 그래서 Cursor와 Codex의 설정 파일에는 시크릿 값이 아예 들어가지 않습니다. Gemini, Antigravity, Copilot은 자리표시자를 스스로 채우지 않으므로 `restore`가 셸 환경에서 채웁니다. Codex의 `config.toml`은 해당 표만 골라 고치므로 주석과 다른 설정은 그대로입니다. `lshed init --agent gemini`처럼 반대 방향도 되며, 시크릿은 마스킹돼 창고에 들어갑니다.

Each agent root keeps its own `lshed/state.json`, so restoring into `~/.codex` never touches what lshed placed in `~/.claude`, and each can use a different profile or `--link` choice. Parts the target does not understand are announced and skipped: a profile with settings keys restores into Codex without them, with a line saying `codex 은 settings 를 다루지 않아 건너뜁니다`. Claude plugin packages are skipped the same way; `github:`/`git:` packages are cloned into every agent root that restores the profile, so give the other agents a profile without them if that is not what you want. `lshed init --agent codex` works too, and a shed made from Codex restores into Claude Code with `CLAUDE.md` generated from the same fragments. The shed's `agent:` is only a default for `--agent` (`$LSHED_AGENT` also works).

에이전트 루트마다 자기 `lshed/state.json`이 있어, `~/.codex`에 복원해도 `~/.claude`에 놓은 것은 건드리지 않고, 루트마다 다른 프로필이나 `--link` 선택을 가질 수 있습니다. 대상이 모르는 부품은 알리고 건너뜁니다. 설정 키가 든 프로필을 Codex에 복원하면 `codex 은 settings 를 다루지 않아 건너뜁니다`라는 줄과 함께 나머지만 놓습니다. Claude 플러그인 패키지도 같은 식으로 건너뛰지만, `github:`/`git:` 패키지는 그 프로필을 복원하는 모든 에이전트 루트에 clone되므로, 원치 않으면 다른 에이전트용으로 그것이 없는 프로필을 두세요. `lshed init --agent codex`도 되고, Codex에서 만든 창고를 Claude Code로 복원하면 같은 조각으로 `CLAUDE.md`가 생성됩니다. 창고의 `agent:`는 `--agent`의 기본값일 뿐입니다(`$LSHED_AGENT`도 됩니다).

### Links instead of copies · 복사 대신 링크

On the machine where you do most of your editing, `restore --link` places skills, agents, commands and instruction fragments as links into the shed instead of copies. Edits in `~/.claude` land in the shed directly, `diff` has nothing to report, and `save` has nothing to do; `lshed sync` is the whole loop.

편집을 주로 하는 기기에서는 `restore --link`가 스킬·에이전트·명령·지침 조각을 복사본 대신 창고를 가리키는 링크로 놓습니다. `~/.claude`에서 한 편집이 곧바로 창고에 있으므로 `diff`는 보고할 것이 없고 `save`는 할 일이 없습니다. `lshed sync`가 순환의 전부입니다.

```
$ lshed restore --link
  ~ skills/add-drivers  (link)
  ~ agents/reviewer.md  (link)
  ~ lshed/instructions/main.md  (link)
  = CLAUDE.md

프로필 "default" 적용 (link): 배치 4, 제거 0
```

The choice is per machine and remembered: later `lshed restore` calls on that machine keep linking, `lshed status` shows `배치 link`, and `restore --no-link` goes back to copies. Other machines are not affected. MCP entries and settings keys are JSON values, not files, so they are always written. Switching profiles removes the links, never the shed behind them. On Windows, directories become junctions with no special permission; single-file parts (agents, commands, fragments) need Developer Mode for a link, and without it lshed copies the file, says so, and treats it like any other copy (`save` still works for it).

선택은 기기별이고 기억됩니다. 그 기기의 이후 `lshed restore`도 계속 링크로 놓고, `lshed status`는 `배치 link`를 보여 주며, `restore --no-link`로 복사로 돌아갑니다. 다른 기기에는 영향이 없습니다. MCP 항목과 설정 키는 파일이 아니라 JSON 값이라 항상 씁니다. 프로필을 바꾸면 링크만 지우고 그 뒤의 창고는 절대 지우지 않습니다. Windows에서는 디렉터리가 특별한 권한 없이 junction이 되고, 파일 하나짜리 부품(에이전트, 명령, 조각)은 링크에 개발자 모드가 필요합니다. 없으면 복사하고 그렇다고 알린 뒤 보통 복사본처럼 다룹니다(`save`도 됩니다).

### Adding things later · 나중에 추가하기

Write a new skill, add an MCP server with `claude mcp add`, clone a toolkit into `~/.claude/skills/`. Then:

새 스킬을 쓰거나, `claude mcp add`로 MCP 서버를 넣거나, 툴킷을 `~/.claude/skills/`에 clone한 뒤:

```
$ lshed add
창고에 없는 항목 3개 (넣으려면 lshed add <key...> 또는 --all):
    skills/paper-review
    mcp/linear
  ≡ packages/superpowers  github:obra/superpowers@main
  · 패키지 gstack 가 생성한 것 53개는 담지 않습니다

$ lshed add paper-review mcp/linear
  + skills/paper-review
  + mcp/linear  (시크릿 → ${LINEAR_API_KEY})

2개를 창고에 넣고 프로필 "default" 에 추가했습니다. 창고를 커밋하세요: /home/me/lshed
```

`add` classifies exactly like `init`, appends to `lshed.yaml` without disturbing your comments, adds the parts to the current profile and to the managed set. Without keys it only lists. `status` shows the count as `창고 밖`. To put a part that is already in the shed into another profile, edit `profiles:` by hand; `add` tells you when that is the case.

`add`는 `init`과 똑같이 분류하고, 주석을 흐트러뜨리지 않고 `lshed.yaml`에 덧붙이며, 현재 프로필과 관리 집합에 넣습니다. 키 없이 부르면 나열만 합니다. `status`는 그 수를 `창고 밖`으로 보여 줍니다. 이미 창고에 있는 부품을 다른 프로필에 넣는 것은 `profiles:`를 직접 고치는 일이고, 그런 경우 `add`가 알려 줍니다.

### Keeping packages current · 패키지 최신으로 유지하기

```
lshed status                # shows "253d1df ≠ lock 0d1bd56 → lshed update" when a clone moved  ·  clone 이 움직였으면 알림
lshed update                # fast-forward every package in the profile, refresh lshed.lock  ·  프로필의 모든 패키지를 당기고 lock 갱신
lshed update gstack --yes   # one package, and run its install: afterwards  ·  하나만, 그리고 install: 실행
```

Git packages are pinned by commit in `lshed.lock`; a new machine gets exactly that commit. Plugins cannot be pinned, so the lock records what got installed and `status` says when it differs from the machine you came from.

git 패키지는 `lshed.lock`에 커밋으로 고정되어 새 기기도 정확히 그 커밋을 받습니다. 플러그인은 고정할 수 없으므로 lock에는 설치된 버전을 적고, 이전 기기와 다르면 `status`가 알려 줍니다.

### Housekeeping · 정리

```
lshed list                  # everything in the shed and which profiles use it  ·  창고의 모든 것과 그것을 쓰는 프로필
lshed list --unused         # parts no profile lists  ·  어느 프로필도 안 쓰는 것
lshed remove skills/old     # delete from the shed (refused while a profile uses it)  ·  창고에서 삭제 (프로필이 쓰는 동안은 거부)
lshed prune --yes           # delete everything unused  ·  안 쓰는 것 전부 삭제
```

`remove` and `prune` delete from the shed without a backup; the shed lives in git, so commit before you prune.

`remove`와 `prune`은 백업 없이 창고에서 지웁니다. 창고는 git 안에 있으니 prune 전에 커밋하세요.

### Reading the output · 출력 읽기

| Mark · 기호 | Meaning · 뜻 |
|---|---|
| `+` | placed / added · 놓음 / 추가함 |
| `=` | already identical, nothing done · 이미 같아서 한 일 없음 |
| `~` | existed with different content, replaced (backed up) · 다른 내용이 있어 교체함 (백업) |
| `-` | removed (backed up) or excluded · 제거함 (백업) 또는 제외 |
| `≡` | package: recorded by source, not copied · 패키지: 출처만 기록, 복사 안 함 |
| `·` | generated by an installer, skipped · 설치기가 만든 것, 건너뜀 |
| `!` | needs your attention · 확인 필요 |
| `↑` `↓` | pushed / pulled (sync), updated (update) · push / pull (sync), 갱신 (update) |

Errors go to stderr with exit code 1. Everything else is on stdout.

오류는 stderr로 나가고 종료 코드는 1입니다. 나머지는 전부 stdout입니다.

## The manifest · 매니페스트

`lshed.yaml` lives at the root of the shed. `init` generates it; edit it by hand from then on. `add` and `remove` edit it for you and keep your comments.

`lshed.yaml`은 창고 루트에 있습니다. `init`이 만들고, 그다음부터는 직접 고칩니다. `add`와 `remove`도 주석을 보존하며 고쳐 줍니다.

```yaml
version: 1
agent: claude-code
exclude: [skills/_gstack-command]   # things init/add must not pick up  ·  init/add 가 집어 오면 안 되는 것
ignore: [dist]                      # extra names never copied (adds to the built-in list)  ·  복사하지 않을 이름 추가

components:
  skills:
    - id: paper-review            # source defaults to file:./skills/paper-review
    - id: grading-helper
  agents:
    - id: reviewer                # file:./agents/reviewer.md
  commands:
    - id: summarize
  instructions:
    - id: base                    # file:./instructions/base.md
    - id: research-style
  mcp:
    - id: exa                     # file:./mcp/exa.json — secrets replaced by ${VAR}  ·  시크릿은 ${VAR}
  settings:
    - id: permissions             # file:./settings/permissions.json — one top-level key of settings.json  ·  settings.json 의 최상위 키 하나
    - id: hooks

packages:
  - id: gstack
    source: github:garrytan/gstack@main
    into: skills/gstack
    install: ./setup

profiles:
  research:
    packages: [gstack]
    skills: [paper-review]
    agents: [reviewer]
    instructions: [base, research-style]    # order matters  ·  순서가 의미 있음
    mcp: [exa]
    settings: [permissions, hooks]
  teaching:
    skills: [grading-helper]
    commands: [summarize]
    instructions: [base]
```

- Component `source` accepts `file:<path relative to the shed>`. Package `source` accepts `github:owner/repo@ref`, `git:<url>#ref`, `claude-marketplace:<owner/repo>`, `claude-plugin:<name>@<marketplace>`.
  부품의 `source`는 `file:<창고 기준 상대 경로>`입니다. 패키지의 `source`는 `github:owner/repo@ref`, `git:<url>#ref`, `claude-marketplace:<owner/repo>`, `claude-plugin:<name>@<marketplace>`를 받습니다.
- Category names come from the adapter. For Claude Code: `skills`, `agents`, `commands`, `instructions`, `mcp`, `settings`. Other agents have `skills`, and `instructions` / `mcp` where the table above says so.
  카테고리 이름은 어댑터가 정합니다. Claude Code는 `skills`, `agents`, `commands`, `instructions`, `mcp`, `settings`이고, 다른 에이전트는 `skills`에 더해 위 표에 있는 대로 `instructions` / `mcp`를 가집니다.
- `ignore:` adds to the built-in list of things never copied: `node_modules`, `.git`, `__pycache__`, `.venv`, cache directories, `*.log`. Build output like `dist/` is not ignored by default, since some skills ship it.
  `ignore:`는 기본 목록(`node_modules`, `.git`, `__pycache__`, `.venv`, 캐시 디렉터리, `*.log`)에 더해집니다. `dist/` 같은 빌드 산출물은 스킬에 따라 필요하므로 기본으로는 빼지 않습니다.
- `exclude:` lists parts that exist locally but must not enter the shed. `init --exclude` writes it.
  `exclude:`는 로컬에는 있지만 창고에 들어가면 안 되는 부품입니다. `init --exclude`가 적어 줍니다.

## Three kinds of things · 세 종류의 것

A real `~/.claude` mixes three kinds of content, and they need different handling:

실제 `~/.claude`에는 세 종류가 섞여 있고, 각각 다르게 다뤄야 합니다.

| Kind · 종류 | Example · 예 | What lshed does · lshed 가 하는 일 |
|---|---|---|
| **Authored** · 직접 만든 것 | a skill you wrote, your `CLAUDE.md`, an MCP server you added · 직접 쓴 스킬, `CLAUDE.md`, 직접 넣은 MCP 서버 | copies it into the shed · 창고에 복사 |
| **Installed** · 설치한 것 | a toolkit you `git clone`d, a plugin · `git clone`한 툴킷, 플러그인 | records source + commit; `restore` clones or installs it back · 출처와 커밋만 기록, `restore`가 다시 clone·설치 |
| **Generated** · 설치가 만든 것 | stub skills an installer wrote for you · 설치기가 만들어 둔 스텁 스킬 | skips them; they return when the installer runs · 건너뜀, 설치기를 돌리면 돌아옴 |

A directory with a `.git` and a remote becomes a **package**. A skill whose symlink points inside a package is treated as generated and skipped. Everything else is authored and copied. The rules that keep this safe:

`.git`과 remote가 있는 디렉터리는 **패키지**가 됩니다. 심볼릭 링크가 패키지 안을 가리키는 스킬은 생성물로 보고 건너뜁니다. 나머지는 직접 만든 것으로 보고 복사합니다. 이것을 안전하게 지키는 규칙은 다음과 같습니다.

- A package that is already present is never touched by `restore`. Your local checkout is yours.
  이미 있는 패키지는 `restore`가 절대 건드리지 않습니다. 로컬 체크아웃은 여러분 것입니다.
- `install:` is a shell command. `restore` and `update` **print it and stop** unless you pass `--yes`. Plugin installs go through Claude Code's own package manager and run without it; `--yes` is forwarded as `-y` for plugins that declare an install command.
  `install:`은 셸 명령입니다. `--yes`가 없으면 `restore`와 `update`는 **보여 주고 멈춥니다.** 플러그인 설치는 Claude Code 자체 패키지 관리자를 거치므로 그 없이도 돌고, 설치 명령을 선언한 플러그인에는 `--yes`가 `-y`로 전달됩니다.
- Packages are not part of the managed set. Switching profiles never deletes a clone.
  패키지는 관리 집합에 들어가지 않습니다. 프로필을 바꿔도 clone은 지워지지 않습니다.

Claude Code plugins are packages with their own scheme. `init` finds user-scope ones in `~/.claude/plugins`; `restore` adds the marketplace first, then runs `claude plugin install`. Project-scope plugins belong to their project and are not recorded.

Claude Code 플러그인은 자기 스킴을 가진 패키지입니다. `init`은 `~/.claude/plugins`의 사용자 범위 플러그인을 찾고, `restore`는 마켓플레이스를 먼저 추가한 뒤 `claude plugin install`을 돌립니다. 프로젝트 범위 플러그인은 그 프로젝트의 것이라 기록하지 않습니다.

## MCP servers and secrets · MCP 서버와 시크릿

User-scope MCP servers live in `~/.claude.json`, next to machine IDs and session state. lshed treats each server as a component of category `mcp`: the shed holds `mcp/<name>.json`, and `restore` edits only the `mcpServers.<name>` key of `~/.claude.json`, leaving everything else in that file alone.

사용자 범위 MCP 서버는 `~/.claude.json` 안에 기기 ID, 세션 상태와 함께 있습니다. lshed는 서버 하나를 `mcp` 카테고리의 부품 하나로 봅니다. 창고에는 `mcp/<이름>.json`이 있고, `restore`는 `~/.claude.json`의 `mcpServers.<이름>` 키만 고치고 나머지는 그대로 둡니다.

**No secret value enters the shed.** `init` and `add` replace values under `env` and `headers` whose key contains a secret-looking word (`key`, `token`, `secret`, `password`, `auth`, `authorization`, `credential`, `cookie`, `session` — whole words, so `MAX_OUTPUT_TOKENS` is left alone) with a `${VAR}` placeholder:

**시크릿 값은 창고에 들어가지 않습니다.** `init`과 `add`는 `env`와 `headers` 아래에서 키 이름에 시크릿처럼 보이는 단어(`key`, `token`, `secret`, `password`, `auth`, `authorization`, `credential`, `cookie`, `session` — 단어 단위라 `MAX_OUTPUT_TOKENS`는 해당 없음)가 있는 값을 `${VAR}` 자리표시자로 바꿉니다.

```json
{ "type": "stdio", "command": "npx", "args": ["-y", "exa-mcp-server"],
  "env": { "EXA_API_KEY": "${EXA_API_KEY}" } }
{ "type": "http", "url": "https://mcp.notion.com/mcp",
  "headers": { "Authorization": "Bearer ${NOTION_AUTHORIZATION}" } }
```

`restore` writes the placeholder as is. Claude Code expands `${VAR}` from the environment when it starts the server, so the value only ever lives in your shell (`export EXA_API_KEY=...` in `~/.zshrc`, or however you manage secrets). `restore` and `status` list the variables the profile needs that are not set. The heuristic is a suggestion: edit the JSON in the shed to add or remove placeholders, and `init` warns when something in `args` or `url` looks like a token. `save` keeps existing placeholders and masks new secret-looking keys, so a rotated key never leaks into the shed by accident. `diff` compares with placeholders as wildcards, so a machine holding real values is not drift.

`restore`는 자리표시자를 그대로 씁니다. Claude Code가 서버를 띄울 때 환경에서 `${VAR}`를 채우므로 값은 셸에만 있습니다(`~/.zshrc`의 `export EXA_API_KEY=...` 등, 시크릿을 관리하는 방식대로). `restore`와 `status`는 프로필에 필요한데 설정되지 않은 변수를 나열합니다. 휴리스틱은 제안일 뿐입니다. 창고의 JSON을 고쳐 자리표시자를 더하거나 빼도 되고, `args`나 `url`에 토큰처럼 보이는 것이 있으면 `init`이 경고합니다. `save`는 기존 자리표시자를 유지하고 새로 생긴 시크릿 키를 마스킹하므로, 교체한 키가 실수로 창고에 새지 않습니다. `diff`는 자리표시자를 와일드카드로 비교해서, 실제 값을 가진 기기가 드리프트로 잡히지 않습니다.

## Settings · 설정

`~/.claude/settings.json` holds hooks, permissions, `env`, the model, the theme, and some state Claude Code writes for itself. lshed does not merge it. Each **top-level key is one component** of category `settings`: the shed holds `settings/permissions.json`, `settings/hooks.json`, and so on, and `restore` writes exactly those keys, leaving the rest of the file alone. A profile can carry `permissions` and `hooks` and leave `model` to each machine.

`~/.claude/settings.json`에는 훅, 권한, `env`, 모델, 테마, 그리고 Claude Code가 스스로 쓰는 상태값이 있습니다. lshed는 이 파일을 병합하지 않습니다. **최상위 키 하나가 `settings` 카테고리의 부품 하나**입니다. 창고에는 `settings/permissions.json`, `settings/hooks.json` 같은 파일이 있고, `restore`는 딱 그 키만 쓰고 나머지는 둡니다. 프로필은 `permissions`와 `hooks`만 실어 나르고 `model`은 기기마다 다르게 둘 수 있습니다.

```
$ lshed add
창고에 없는 항목 3개:
    settings/hooks  ! 패키지 gstack 안을 가리킵니다. 그 설치가 만든 것이면 exclude 하세요: settings/hooks
    settings/model
    settings/theme
```

- `enabledPlugins` is never taken: the plugin packages own it, and `restore` rebuilds it by installing them.
  `enabledPlugins`는 담지 않습니다. 플러그인 패키지의 몫이고, `restore`가 설치하면서 다시 만듭니다.
- Absolute paths under your home directory become `${HOME}/…` in the shed, so a hook command written on one machine works on another. Claude Code does not expand variables in `settings.json`, so `restore` fills `${HOME}` and any `${VAR}` itself from your shell; unset variables are reported and left as placeholders.
  홈 아래 절대 경로는 창고에서 `${HOME}/…`가 되어, 한 기기에서 쓴 훅 명령이 다른 기기에서도 돕니다. Claude Code는 `settings.json`의 변수를 채우지 않으므로 `restore`가 `${HOME}`과 `${VAR}`를 셸에서 직접 채우고, 없는 변수는 알린 뒤 자리표시자로 둡니다.
- `env` is treated as a secret map: keys that look secret are masked, the rest (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`, …) travel as they are.
  `env`는 시크릿 맵으로 봅니다. 시크릿처럼 보이는 키는 마스킹하고 나머지(`CLAUDE_CODE_MAX_OUTPUT_TOKENS` 등)는 그대로 갑니다.
- A value pointing inside a package (a hook a toolkit's installer wrote) is flagged. If the installer recreates it, put it in `exclude:` and let `restore --yes` bring it back.
  패키지 안을 가리키는 값(툴킷 설치기가 쓴 훅)은 표시됩니다. 설치기가 다시 만들어 주는 것이면 `exclude:`에 넣고 `restore --yes`가 되살리게 두세요.
- Since the shed owns the whole key, extra permissions you grant locally show up in `diff` and go into the shed with `save`, like any other edit.
  창고가 키 전체를 소유하므로, 로컬에서 추가한 권한은 `diff`에 나타나고 다른 편집처럼 `save`로 창고에 들어갑니다.

## Commands · 명령 레퍼런스

```
lshed init [--shed <dir>] [--profile <name>] [--exclude <id...>]
lshed add [keys...] [--all]                     put things that appeared since init into the shed  ·  init 뒤에 생긴 것을 창고로
lshed restore [profile] [--pick] [--link | --no-link] [--dry-run] [--no-backup] [--yes]   (--agent <name> to target another tool)
lshed status                                    applied profile, drift, packages, missing env, new things  ·  적용 프로필, 드리프트, 패키지, 없는 환경변수, 새것
lshed diff                                      files (or JSON keys) that differ between local and shed  ·  로컬과 창고가 다른 파일(또는 JSON 키)
lshed save [ids...]                             copy local edits back into the shed  ·  로컬 편집을 창고로
lshed sync [-m <msg>] [--no-push] [--dry-run]   commit the shed, pull --rebase, push
lshed update [ids...] [--dry-run] [--yes]       pull packages forward, refresh lshed.lock  ·  패키지 당기고 lock 갱신
lshed list [--unused]                           what is in the shed, and which profiles use it  ·  창고의 내용과 그것을 쓰는 프로필
lshed remove <key>                              drop a component or package from the shed  ·  창고에서 삭제
lshed prune [--yes]                             drop everything no profile uses  ·  안 쓰는 것 전부 삭제
lshed scan                                      list what the agent root holds, without writing anything  ·  루트를 읽기만 하고 나열
```

Keys are `category/id`, or just `id` when unambiguous: `skills/paper-review`, `mcp/exa`, `packages/gstack`.

키는 `카테고리/id`이고, 모호하지 않으면 `id`만 써도 됩니다: `skills/paper-review`, `mcp/exa`, `packages/gstack`.

Global options: `--shed <dir>` (or `LSHED_HOME`; after the first restore lshed remembers it), `--agent <name>` (or `LSHED_AGENT`; default is the shed's `agent:`, then `claude-code`), `--root <dir>` (agent config root, default is the agent's own, e.g. `~/.claude` or `~/.codex`).

공통 옵션: `--shed <dir>`(또는 `LSHED_HOME`, 첫 restore 뒤에는 기억함), `--agent <name>`(또는 `LSHED_AGENT`, 기본은 창고의 `agent:`, 그다음 `claude-code`), `--root <dir>`(에이전트 설정 루트, 기본은 에이전트 자체 위치인 `~/.claude`나 `~/.codex` 등).

### What `restore` does · `restore` 가 하는 일

0. Installs any package in the profile that is missing, at the version in `lshed.lock`.
   프로필의 패키지 중 없는 것을 `lshed.lock`의 버전으로 설치합니다.
1. Removes paths that the **previous** profile placed and the new one doesn't need.
   **이전** 프로필이 놓았고 새 프로필에는 없는 경로를 치웁니다.
2. Copies every part of the new profile into place (or links it into the shed, with `--link` or on a machine that used it before); writes MCP entries into `~/.claude.json` and settings keys into `settings.json`.
   새 프로필의 부품을 제자리에 복사합니다(`--link`이거나 전에 링크를 쓴 기기라면 창고로 가는 링크로). MCP 항목은 `~/.claude.json`에, 설정 키는 `settings.json`에 씁니다.
3. Regenerates the instructions file.
   지침 파일을 다시 만듭니다.

Anything it overwrites or removes is backed up first under `~/.claude/lshed/backups/<timestamp>/`, unless you pass `--no-backup`. Files lshed never placed are left alone. `--dry-run` prints the plan and writes nothing. With `--pick`, a checklist per non-empty category comes first (packages, skills, agents, commands, instructions, MCP servers, settings keys). `[profile]` pre-checks that profile's parts. The result is written to `lshed.yaml` as a profile, and then steps 0–3 run for it.

덮어쓰거나 치우는 것은 `--no-backup`이 없는 한 먼저 `~/.claude/lshed/backups/<시각>/`에 백업합니다. lshed가 놓은 적 없는 파일은 건드리지 않습니다. `--dry-run`은 계획만 출력합니다. `--pick`이면 비어 있지 않은 카테고리마다 체크리스트가 먼저 나옵니다(packages, skills, agents, commands, instructions, MCP 서버, 설정 키). `[profile]`을 주면 그 프로필의 부품이 미리 체크됩니다. 결과는 `lshed.yaml`에 프로필로 저장되고, 그 프로필로 0~3단계가 돕니다.

### What `sync` does · `sync` 가 하는 일

1. Warns if `diff` shows local edits you have not saved.
   `diff`에 저장하지 않은 로컬 편집이 있으면 경고합니다.
2. Commits everything in the shed (message names the changed parts, or `-m`).
   창고의 모든 것을 커밋합니다(메시지는 바뀐 부품 이름, 또는 `-m`).
3. If `origin` exists: `git pull --rebase`, then `git push` (sets the upstream the first time).
   `origin`이 있으면 `git pull --rebase` 뒤 `git push`(첫 번째는 upstream 설정).
4. If commits came in, tells you to run `lshed restore`.
   받은 커밋이 있으면 `lshed restore`를 돌리라고 알립니다.

On a conflict it aborts the rebase, leaves the shed clean with your commit intact, and tells you to resolve with git. Without a remote it only commits. It never runs `save` for you.

충돌이 나면 rebase를 중단하고, 커밋은 그대로 둔 채 창고를 깨끗하게 남기고, git으로 해결하라고 알립니다. remote가 없으면 커밋만 합니다. `save`를 대신 돌리지는 않습니다.

### Ownership · 소유권

The shed is the source of truth for authored parts: `save` copies local edits back for `file:` components, and a linked part is the shed. Packages are owned by their upstream: `update` pulls them, `save` ignores them.

직접 만든 부품의 진실은 창고입니다. `save`는 `file:` 부품의 로컬 편집을 창고로 되가져오고, 링크된 부품은 곧 창고입니다. 패키지의 주인은 upstream입니다. `update`가 당겨 오고, `save`는 건드리지 않습니다.

## Where things live · 어디에 무엇이 있나

```
<shed>/
  lshed.yaml                                    manifest  ·  매니페스트
  lshed.lock                                    package versions (generated)  ·  패키지 버전 (생성됨)
  skills/<id>/    agents/<id>.md    commands/<id>.md    instructions/<id>.md
  mcp/<id>.json                                 secrets as ${VAR}  ·  시크릿은 ${VAR}
  settings/<id>.json                            one top-level key each; home paths as ${HOME}  ·  최상위 키 하나씩, 홈 경로는 ${HOME}

~/.claude/
  skills/ agents/ commands/ CLAUDE.md           ← placed by restore  ·  restore 가 놓음
  settings.json  <id>                           ← one key per settings component; the rest is untouched  ·  부품마다 키 하나, 나머지는 그대로
  lshed/state.json                              ← which profile, which paths are managed  ·  어느 프로필, 어느 경로를 관리하는지
  lshed/instructions/<id>.md                    ← fragments imported by CLAUDE.md  ·  CLAUDE.md 가 import 하는 조각
  lshed/backups/<timestamp>/                    ← whatever restore replaced  ·  restore 가 교체한 것
~/.claude.json  mcpServers.<id>                 ← one key per mcp component; the rest of the file is untouched  ·  부품마다 키 하나, 나머지는 그대로

~/.codex/  ~/.gemini/  ~/.copilot/  ~/.cursor/  ~/.gemini/config/  ~/.agents/
  skills/  <instructions file>  <mcp file>      ← the same, per --agent (see the table above; codex skills live in ~/.agents/skills)  ·  --agent 별로 같은 구조 (codex 의 스킬은 ~/.agents/skills)
  lshed/state.json  lshed/backups/              ← each root keeps its own  ·  루트마다 따로
```

`state.json` is per machine and is not part of the shed. If `CLAUDE_CONFIG_DIR` is set, lshed uses it as the root and writes `.claude.json` inside it, as Claude Code does.

`state.json`은 기기별이고 창고에 들어가지 않습니다. `CLAUDE_CONFIG_DIR`가 있으면 lshed는 그것을 루트로 쓰고, Claude Code처럼 `.claude.json`도 그 안에 씁니다.

## What has been verified · 검증된 것

- Tests, a CLI smoke run and the standalone binaries run on every push on **Ubuntu, macOS and Windows** (Node 20 and 22). Windows uses junctions for `--link` and `claude.cmd` for plugin installs.
  테스트, CLI 스모크, 단독 실행파일이 push마다 **Ubuntu, macOS, Windows**(Node 20, 22)에서 돕니다. Windows는 `--link`에 junction을, 플러그인 설치에 `claude.cmd`를 씁니다.
- The other agents are checked against the tools themselves, not just their docs. `scripts/vm/probe.sh` restores a throwaway shed into a tool's real root and asks the tool, non-interactively, for a passphrase kept in a skill, a codeword kept in the instructions file, and the same skill again through a `--link` symlink. Codex 0.153.2 and Antigravity CLI 1.1.26 pass every check; Gemini CLI, Copilot CLI and Cursor are verified for file placement and format so far. `scripts/vm/README.md` has the details and a cloud-init file for running the whole thing on a fresh VM.
  다른 에이전트는 문서만이 아니라 도구 자체로 확인합니다. `scripts/vm/probe.sh`는 임시 창고를 도구의 실제 루트에 복원한 뒤, 스킬에 든 암호어, 지침 파일에 든 코드워드, `--link` 링크를 거친 같은 스킬을 비대화형으로 물어봅니다. Codex 0.153.2와 Antigravity CLI 1.1.26은 모든 검사를 통과했고, Gemini CLI·Copilot CLI·Cursor는 아직 파일 배치와 형식까지만 확인했습니다. 자세한 내용과 새 VM에서 전부 돌리는 cloud-init 파일은 `scripts/vm/README.md`에 있습니다.

## Not in scope (yet) · 아직 범위 밖

- Secrets beyond "name the variable". Encrypted values, `op://` references and OS keychains are possible later; today lshed is deliberately no better than dotfiles here.
  "변수 이름만 적는" 것 이상의 시크릿 처리. 암호화된 값, `op://` 참조, OS 키체인은 나중 일이고, 지금은 일부러 dotfiles보다 나을 것이 없게 두었습니다.
- Project-scope MCP servers (`.mcp.json`, `~/.claude.json` `projects.*`) and project-scope plugins. They belong to the project.
  프로젝트 범위 MCP 서버(`.mcp.json`, `~/.claude.json`의 `projects.*`)와 프로젝트 범위 플러그인. 프로젝트의 것입니다.
- For the other agents, only skills, the instructions file and MCP servers travel. Their own settings files, rules folders and plugins stay where they are.
  다른 에이전트는 스킬, 지침 파일, MCP 서버만 옮깁니다. 각 도구의 설정 파일, 규칙 폴더, 플러그인은 그대로 둡니다.

## Troubleshooting · 문제 해결

- **"창고 위치를 모릅니다"** — pass `--shed <dir>` or set `LSHED_HOME`. After one successful `restore`, lshed remembers it.
  `--shed <dir>`를 주거나 `LSHED_HOME`을 설정하세요. `restore`가 한 번 성공하면 기억합니다.
- **restore replaced my `CLAUDE.md`** — it is in `~/.claude/lshed/backups/<timestamp>/CLAUDE.md`. Move its content into a fragment in the shed and add that fragment to your profile.
  **restore가 내 `CLAUDE.md`를 바꿨다** — `~/.claude/lshed/backups/<시각>/CLAUDE.md`에 있습니다. 내용을 창고의 조각으로 옮기고 그 조각을 프로필에 넣으세요.
- **I edited a skill locally and want to keep it** — `lshed diff` to see, `lshed save <id>` to push it into the shed, then `lshed sync`.
  **로컬에서 고친 스킬을 지키고 싶다** — `lshed diff`로 보고, `lshed save <id>`로 창고에 넣고, `lshed sync`.
- **`status` says a package differs from the lock** — something updated the clone or plugin behind lshed's back (Claude Code auto-updates plugins). `lshed update` records the new version.
  **`status`가 패키지가 lock과 다르다고 한다** — 무언가가 lshed 몰래 clone이나 플러그인을 갱신했습니다(Claude Code는 플러그인을 자동 갱신합니다). `lshed update`가 새 버전을 기록합니다.
- **`status` keeps listing the same new things** — they are installer aliases or scratch. Add them to `exclude:` in `lshed.yaml`.
  **`status`가 같은 새 항목을 계속 보여 준다** — 설치기 별칭이거나 임시 파일입니다. `lshed.yaml`의 `exclude:`에 넣으세요.
- **restore says an MCP variable is missing** — export it in your shell profile and restart Claude Code. The placeholder in `~/.claude.json` is correct; Claude Code fills it at startup.
  **restore가 MCP 변수가 없다고 한다** — 셸 프로필에서 export하고 Claude Code를 다시 시작하세요. `~/.claude.json`의 자리표시자는 맞게 들어간 것이고, Claude Code가 시작할 때 채웁니다.
- **restore wrote a hook with the wrong path** — the shed stores home paths as `${HOME}/…`. If a command points elsewhere on this machine, edit the JSON in the shed to use `${HOME}` or another variable and `restore` again.
  **restore가 훅 경로를 엉뚱하게 썼다** — 창고는 홈 경로를 `${HOME}/…`로 담습니다. 이 기기에서 다른 곳을 가리켜야 하면 창고의 JSON을 `${HOME}`이나 다른 변수로 고치고 다시 `restore`하세요.
- **`--link` copied a file on Windows** — single-file links need Developer Mode. Turn it on and `restore` again, or keep the copy and use `save` for that file.
  **Windows에서 `--link`가 파일을 복사했다** — 파일 하나짜리 링크는 개발자 모드가 필요합니다. 켜고 다시 `restore`하거나, 복사본을 두고 그 파일은 `save`로 다루세요.
- **sync stopped on a conflict** — `cd <shed> && git pull --rebase`, resolve, `git rebase --continue`, then `lshed sync` again.
  **sync가 충돌로 멈췄다** — `cd <창고> && git pull --rebase`, 해결, `git rebase --continue`, 그리고 다시 `lshed sync`.

## License · 라이선스

MIT
