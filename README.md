# monoDown — 프리미어 프로용 유튜브 다운로드 패널

URL을 붙여넣으면 최고 화질로 받아서 프리미어에서 바로 편집 가능한 형식으로 변환하고,
프로젝트의 `00 monoDown` 빈에 자동으로 가져옵니다. macOS와 Windows를 모두 지원합니다.

## 설치

**macOS**: 터미널에서 이 폴더로 이동한 뒤 `bash install-mac.command`
(Homebrew가 있으면 ffmpeg/deno를 brew로, 없으면 정적 빌드를 내려받습니다.)

**Windows**: `install-win.bat` 더블클릭

설치 후 프리미어 프로를 재시작하고 **창 > 확장 > monoDown**를 엽니다.
패널 아래쪽에 `yt-dlp ✓ ffmpeg ✓ deno ✓`가 보이면 준비 완료입니다.

## 자동 업데이트 (한 번만 설정)

패널은 열릴 때마다 GitHub 저장소의 `version.json`을 확인하고, 버전이 올라가 있으면
새 파일을 받아 패널을 스스로 다시 불러옵니다. 재설치가 필요 없습니다.

1. github.com에서 **공개(Public)** 저장소를 하나 만듭니다 (예: `ytgrabber`).
2. 이 폴더의 내용물을 저장소에 그대로 올립니다 (Add file > Upload files로 드래그). `bin` 폴더는 빼도 됩니다.
3. 패널의 **업데이트 설정**에 `아이디/저장소`(예: `myname/monodown`)를 입력하고 저장합니다.

이후 업데이트는 새 버전 파일을 저장소에 다시 올리기만 하면 됩니다.
모든 컴퓨터의 패널이 다음에 열릴 때 자동으로 반영합니다.
`CSXS/manifest.xml`이 바뀐 업데이트만 프리미어 재시작이 필요하고, 패널이 알려줍니다.

## 화질 모드

| 모드 | 받는 화질 | 결과 파일 | 언제 쓰나 |
|---|---|---|---|
| 바로 편집 | H.264 중 최고 (대개 1080p) | .mp4 | 빠르게 받아 바로 쓸 때 |
| 최고 화질 → ProRes 422 HQ | 4K/8K 포함 최고 | .mov | 4K 소스로 편집할 때 (가장 부드러움, 1분에 수 GB) |
| 최고 화질 → H.264 | 4K/8K 포함 최고 | .mp4 | 용량을 아끼고 싶을 때 (CRF 16, 변환 느림) |
| 최고 화질 원본 | 4K/8K 포함 최고 | .mkv (VP9/AV1) | 다른 툴로 따로 처리할 때 |

유튜브의 1440p 이상 영상은 VP9/AV1로만 제공되는 경우가 많고, 프리미어는 이 코덱을 잘 다루지 못합니다.
그래서 고해상도는 변환 모드를 쓰는 것을 권장합니다.

## 구조

```
monoDown/
├─ CSXS/manifest.xml   확장 정의 (Node.js 활성화)
├─ index.html          패널 UI
├─ css/style.css
├─ js/main.js          yt-dlp/ffmpeg 실행, 진행률, 임포트
├─ js/updater.js       GitHub 자동 업데이트
├─ version.json        버전과 업데이트 대상 파일 목록
├─ jsx/host.jsx        프리미어 ExtendScript (폴더 선택, 빈 생성, importFiles)
├─ bin/mac, bin/win    설치 스크립트가 yt-dlp / ffmpeg / deno를 넣는 곳
└─ .debug              크롬 디버깅용 (http://localhost:8088)
```

도구 탐색 순서: `bin/<os>` → (mac) `/opt/homebrew/bin`, `/usr/local/bin` → 시스템 PATH

## 문제 해결

- **패널이 메뉴에 안 보임**: PlayerDebugMode가 적용되지 않은 것입니다. 설치 스크립트를 다시 실행하고 프리미어를 완전히 종료 후 재시작하세요.
- **HTTP 403 Forbidden**: 패널이 자동으로 재시도하고, yt-dlp를 nightly로 올리고, 다른 접속 방식으로 바꿔 다시 시도합니다. 그래도 실패하면 잠시 후 다시 시도하세요.
- **"Sign in to confirm you're not a bot" / 포맷이 적게 나옴**: 패널 하단의 *yt-dlp 업데이트*를 누르세요. 유튜브가 바뀔 때마다 yt-dlp도 자주 업데이트됩니다. deno가 ✗라면 설치 스크립트를 다시 실행하세요.
- **mac에서 "확인되지 않은 개발자" 경고**: `xattr -dr com.apple.quarantine ~/Library/Application\ Support/Adobe/CEP/extensions/monoDown/bin`
- **디버깅**: 프리미어 실행 중 크롬에서 `http://localhost:8088` 접속 → 콘솔 확인

## 사용 범위

본인 채널 영상, 크리에이티브 커먼즈 영상, 권리자 허락을 받은 영상에 사용하세요.
유튜브 약관은 허가 없는 다운로드를 금지하고 있습니다.
