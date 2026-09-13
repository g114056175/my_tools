param([string]$Scratch = "$PSScriptRoot\..\..\..\work\native-smoke", [switch]$Capture)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $PSScriptRoot 'AudioSmoke.exe'
& clang++ -std=c++20 -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0A00 -municode -static -O2 (Join-Path $root 'tests\AudioSmoke.cpp') (Join-Path $root 'src\Audio.cpp') -o $binary -lwinmm -lmmdevapi -lmfplat -lmfreadwrite -lmfuuid -lole32 -luuid
if ($LASTEXITCODE -ne 0) { throw 'Smoke build failed' }
New-Item -ItemType Directory -Path $Scratch -Force | Out-Null
& $binary $Scratch
if ($LASTEXITCODE -ne 0) { throw 'Audio smoke failed' }
if ($Capture) {
    $captureBinary = Join-Path $PSScriptRoot 'CaptureSmoke.exe'
    & clang++ -std=c++20 -DUNICODE -D_UNICODE -D_WIN32_WINNT=0x0A00 -municode -static -O2 (Join-Path $root 'tests\CaptureSmoke.cpp') (Join-Path $root 'src\Audio.cpp') -o $captureBinary -lwinmm -lmmdevapi -lmfplat -lmfreadwrite -lmfuuid -lole32 -luuid
    if ($LASTEXITCODE -ne 0) { throw 'Capture smoke build failed' }
    & $captureBinary $Scratch
    if ($LASTEXITCODE -ne 0) { throw 'Capture smoke failed' }
}
