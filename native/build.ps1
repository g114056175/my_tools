param([switch]$Debug)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = (Get-Command clang++ -ErrorAction Stop).Source
$windres = (Get-Command llvm-windres -ErrorAction Stop).Source
$out = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$resource = Join-Path $out 'resource.o'
& $windres -i (Join-Path $root 'src\Resource.rc') -o $resource -O coff
if ($LASTEXITCODE -ne 0) { throw 'Resource compile failed' }
$flags = @('-std=c++20', '-DUNICODE', '-D_UNICODE', '-D_WIN32_WINNT=0x0A00', '-mwindows', '-municode', '-static', '-fuse-ld=lld')
if ($Debug) { $flags += @('-O0', '-g') } else { $flags += @('-O2', '-flto', '-s', '-ffunction-sections', '-fdata-sections', '-Wl,--gc-sections') }
$sources = @((Join-Path $root 'src\Main.cpp'), (Join-Path $root 'src\Audio.cpp'), $resource)
$target = Join-Path $out 'VoiceCaptureLiteNative.exe'
& $compiler @flags @sources -o $target -lwinmm -lmmdevapi -lmfplat -lmfreadwrite -lmfuuid -lole32 -luuid -lmsimg32 -ldwmapi -lshell32 -lcomdlg32 -lshlwapi
if ($LASTEXITCODE -ne 0) { throw 'C++ build failed' }
$size = (Get-Item -LiteralPath $target).Length
Write-Host "Built $target ($size bytes; $([math]::Round($size / 1MB, 2)) MiB)"
