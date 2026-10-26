param([string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'RegionRecorder.exe'))
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$out=Join-Path $root '.build'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$clang=(Get-Command clang++ -ErrorAction Stop).Source
$resource=Join-Path $out 'recorder.o'
& (Join-Path (Split-Path -Parent $clang) 'windres.exe') '-I' $root '-I' (Join-Path $root 'project1_region_recorder') '-i' (Join-Path $root 'project1_region_recorder/recorder.rc') '-o' $resource
if($LASTEXITCODE -ne 0){throw 'DXGI recorder icon/manifest compilation failed'}
$flags=@('-std=c++20','-O2','-DUNICODE','-D_UNICODE','-DWINVER=0x0A00','-D_WIN32_WINNT=0x0A00','-I',$root,'-Wall','-Wextra','-Wpedantic','-static','-s')
$sources=@('common/dxgi_capture.cpp','common/image_utils.cpp','project1_region_recorder/main.cpp',
    'project1_region_recorder/recorder_ui.cpp','project1_region_recorder/mp4_writer.cpp',
    'project1_region_recorder/gif_writer.cpp','project1_region_recorder/region_selector.cpp')
$libraries=@('-ld3d11','-ldxgi','-lole32','-luuid','-lmfplat','-lmfreadwrite','-lmfuuid','-lpropsys','-lshlwapi','-lcomdlg32','-lcomctl32','-lshell32','-luser32','-lgdi32','-lgdiplus','-lkernel32')
$output=[IO.Path]::GetFullPath($OutputPath)
$arguments=$flags+@($sources|ForEach-Object{Join-Path $root $_})+@($resource,'-o',$output,'-municode','-mwindows','-ffunction-sections','-fdata-sections','-Wl,--gc-sections','-Wl,--icf=all')+$libraries
& $clang @arguments
if($LASTEXITCODE -ne 0){throw 'DXGI recorder compilation failed'}
Write-Output "Built: $output"
