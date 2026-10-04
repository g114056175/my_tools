$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$destination = Split-Path -Parent $root
$clang = (Get-Command clang++ -ErrorAction Stop).Source
$flags = @('-std=c++20','-O2','-DUNICODE','-D_UNICODE','-DWINVER=0x0A00',
    '-D_WIN32_WINNT=0x0A00','-I',$root,'-Wall','-Wextra','-Wpedantic','-static','-s')
if (Test-Path -LiteralPath (Join-Path $root 'project1_region_recorder/main.cpp')) {
    $name = 'region_recorder'
    $objectDirectory = Join-Path $root '.build'
    [void](New-Item -ItemType Directory -Force -Path $objectDirectory)
    $resource = Join-Path $objectDirectory 'recorder.o'
    & (Join-Path (Split-Path -Parent $clang) 'windres.exe') '-I' (Join-Path $root 'project1_region_recorder') '-i' (Join-Path $root 'project1_region_recorder/recorder.rc') '-o' $resource
    if ($LASTEXITCODE -ne 0) { throw 'Resource compilation failed' }
    $sources = @('common/wgc_capture.cpp','common/image_utils.cpp',
        'project1_region_recorder/main.cpp','project1_region_recorder/recorder_ui.cpp',
        'project1_region_recorder/mp4_writer.cpp','project1_region_recorder/gif_writer.cpp',
        'project1_region_recorder/region_selector.cpp')
    $libraries = @('-ld3d11','-ldxgi','-lruntimeobject','-lwindowsapp','-lole32','-luuid',
        '-lmfplat','-lmfreadwrite','-lmfuuid','-lpropsys','-lshlwapi','-lcomdlg32',
        '-lcomctl32','-lshell32','-luser32','-lgdi32','-lgdiplus','-lkernel32')
} elseif (Test-Path -LiteralPath (Join-Path $root 'project3_dwm_monitor/main.cpp')) {
    $name = 'dwm_window_monitor'
    $sources = @('project3_dwm_monitor/main.cpp')
    $libraries = @('-ldwmapi','-lole32','-luser32','-lgdi32','-lgdiplus','-lcomctl32','-lkernel32')
} else {
    $name = 'window_monitor'
    $sources = @('common/wgc_capture.cpp','project2_window_monitor/main.cpp')
    $libraries = @('-ld3d11','-ldxgi','-lruntimeobject','-lwindowsapp','-lole32','-luuid',
        '-ldwmapi','-luser32','-lgdi32','-lgdiplus','-lcomctl32','-lkernel32')
}
$arguments = $flags + @($sources | ForEach-Object { Join-Path $root $_ })
if ($resource) { $arguments += $resource }
$output = Join-Path $destination ($name + '.exe')
$arguments += @('-o',$output,'-municode','-mwindows','-ffunction-sections','-fdata-sections',
    '-Wl,--gc-sections','-Wl,--icf=all') + $libraries
& $clang @arguments
if ($LASTEXITCODE -ne 0) { throw "$name compilation failed" }
Write-Output "Built: $output"
