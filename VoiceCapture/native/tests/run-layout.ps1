$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $PSScriptRoot 'UiLayoutTest.exe'
$sources = @((Join-Path $PSScriptRoot 'UiLayoutTest.cpp'), (Join-Path $root 'src\Audio.cpp'))
$flags = @('-std=c++20', '-DUNICODE', '-D_UNICODE', '-D_WIN32_WINNT=0x0A00', '-municode', '-static', '-O2')
& clang++ @flags @sources -o $binary -lwinmm -lmmdevapi -lmfplat -lmfreadwrite -lmfuuid -lole32 -luuid -luser32 -lgdi32 -lcomctl32 -lmsimg32 -ldwmapi -lshell32 -lcomdlg32 -lshlwapi
if ($LASTEXITCODE -ne 0) { throw 'UI layout test compile failed' }
& $binary
if ($LASTEXITCODE -ne 0) { throw 'UI layout tests failed' }
Write-Host 'UI layout tests passed'
