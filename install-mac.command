#!/bin/bash
# monoDown 설치 스크립트 (macOS)
# 사용법: 터미널에서  bash install-mac.command   (또는 Finder에서 더블클릭)
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/monoDown"
ARCH="$(uname -m)"   # arm64 또는 x86_64

echo "▶ 1/4 서명 안 된 확장 허용 (PlayerDebugMode)"
for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

killall cfprefsd 2>/dev/null || true   # 설정이 바로 반영되도록

# 예전 이름(YT Grabber)으로 설치된 것이 있으면 제거
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/YTGrabber"

echo "▶ 2/4 확장 복사 → $DEST"
mkdir -p "$DEST"
rsync -a --delete --exclude 'bin/win' --exclude '*.ps1' --exclude '*.bat' "$SRC/" "$DEST/"
BIN="$DEST/bin/mac"
mkdir -p "$BIN"
TMP="$(mktemp -d)"

echo "▶ 3/4 yt-dlp 다운로드"
curl -L --fail -o "$BIN/yt-dlp" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
chmod +x "$BIN/yt-dlp"

echo "▶ 4/4 ffmpeg / deno 준비"
if command -v brew >/dev/null 2>&1; then
  echo "  Homebrew 발견: brew로 설치합니다"
  brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
  brew list deno   >/dev/null 2>&1 || brew install deno
else
  if [ "$ARCH" = "arm64" ]; then FF_ARCH="arm64"; DENO_T="aarch64-apple-darwin"; else FF_ARCH="amd64"; DENO_T="x86_64-apple-darwin"; fi
  echo "  ffmpeg 정적 빌드 다운로드 ($FF_ARCH)"
  if curl -L --fail -o "$TMP/ffmpeg.zip" "https://ffmpeg.martin-riedl.de/redirect/latest/macos/$FF_ARCH/release/ffmpeg.zip"; then
    unzip -o -q "$TMP/ffmpeg.zip" -d "$TMP/ff"
  else
    echo "  대체 경로(evermeet.cx, Intel 빌드) 사용"
    curl -L --fail -o "$TMP/ffmpeg.zip" "https://evermeet.cx/ffmpeg/getrelease/zip"
    unzip -o -q "$TMP/ffmpeg.zip" -d "$TMP/ff"
  fi
  find "$TMP/ff" -name ffmpeg -type f -exec cp {} "$BIN/ffmpeg" \;
  chmod +x "$BIN/ffmpeg"
  echo "  deno 다운로드 ($DENO_T)"
  curl -L --fail -o "$TMP/deno.zip" "https://github.com/denoland/deno/releases/latest/download/deno-$DENO_T.zip"
  unzip -o -q "$TMP/deno.zip" -d "$BIN"
  chmod +x "$BIN/deno"
fi

# Gatekeeper 격리 속성 제거 (다운로드한 실행 파일이 차단되지 않도록)
xattr -dr com.apple.quarantine "$BIN" 2>/dev/null || true
rm -rf "$TMP"

echo ""
echo "✅ 설치 완료. 프리미어 프로를 재시작한 뒤  창 > 확장 > monoDown  를 여세요."
