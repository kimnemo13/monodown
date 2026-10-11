\xef\xbb\xbf# monoDown 설치 스크립트 (Windows)
# 사용법: install-win.bat 더블클릭 (이 스크립트를 실행 정책 우회로 실행)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:APPDATA "Adobe\CEP\extensions\monoDown"

Write-Host "1/4 서명 안 된 확장 허용 (PlayerDebugMode)"
foreach ($v in 9..13) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  Set-ItemProperty -Path $key -Name "PlayerDebugMode" -Value "1" -Type String
}

$Old = Join-Path $env:APPDATA "Adobe\CEP\extensions\YTGrabber"
if (Test-Path $Old) { Remove-Item $Old -Recurse -Force }

Write-Host "2/4 확장 복사 -> $Dest"
if (Test-Path $Dest) { Remove-Item $Dest -Recurse -Force }
New-Item -ItemType Directory -Path $Dest -Force | Out-Null
Get-ChildItem -Path $Src -Force | Where-Object { $_.Name -notin @("install-mac.command") } |
  ForEach-Object { Copy-Item $_.FullName -Destination $Dest -Recurse -Force }
$Bin = Join-Path $Dest "bin\win"
New-Item -ItemType Directory -Path $Bin -Force | Out-Null
$Tmp = Join-Path $env:TEMP ("monodown_" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null

Write-Host "3/4 yt-dlp 다운로드"
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $Bin "yt-dlp.exe")

Write-Host "4/4 ffmpeg / deno 다운로드"
$ffZip = Join-Path $Tmp "ffmpeg.zip"
Invoke-WebRequest "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $ffZip
Expand-Archive $ffZip -DestinationPath (Join-Path $Tmp "ff") -Force
Get-ChildItem (Join-Path $Tmp "ff") -Recurse -Include ffmpeg.exe, ffprobe.exe | ForEach-Object { Copy-Item $_.FullName $Bin -Force }

$denoZip = Join-Path $Tmp "deno.zip"
Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile $denoZip
Expand-Archive $denoZip -DestinationPath $Bin -Force

Get-ChildItem $Bin | Unblock-File
Remove-Item $Tmp -Recurse -Force

Write-Host ""
Write-Host "설치 완료. 프리미어 프로를 재시작한 뒤 창 > 확장 > monoDown 를 여세요."
