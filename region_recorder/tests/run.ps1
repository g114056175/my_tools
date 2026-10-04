$ErrorActionPreference = 'Stop'
$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'src'
$output = Join-Path $root '.build/tests'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$clang = (Get-Command clang++ -ErrorAction Stop).Source
$flags = @('-std=c++20','-O2','-DUNICODE','-D_UNICODE','-DWINVER=0x0A00',
    '-D_WIN32_WINNT=0x0A00','-I',$root,'-Wall','-Wextra','-Wpedantic','-static')
$libraries = @('-municode','-ld3d11','-ldxgi','-lruntimeobject','-lwindowsapp','-lole32','-luuid',
    '-lmfplat','-lmfreadwrite','-lmfuuid','-lpropsys','-lshlwapi','-luser32','-lgdi32','-lkernel32')
foreach ($name in @('recorder_visual_smoke','recording_limits_smoke')) {
    $sources = @('common/wgc_capture.cpp','project1_region_recorder/gif_writer.cpp')
    $defines = @()
    if ($name -eq 'recorder_visual_smoke') {
        $sources += 'project1_region_recorder/region_selector.cpp'
    } else {
        $sources += @('common/image_utils.cpp','project1_region_recorder/main.cpp','project1_region_recorder/mp4_writer.cpp')
        $defines = @('-DLC_RECORDER_WORKER_TEST')
    }
    $exe = Join-Path $output ($name+'.exe')
    $arguments = $flags + $defines + @($sources | ForEach-Object { Join-Path $root $_ }) +
        @((Join-Path $PSScriptRoot ($name+'.cpp')),'-o',$exe) + $libraries
    & $clang @arguments
    if ($LASTEXITCODE -ne 0) { throw ($name+' build failed') }
    & $exe $output
    if ($LASTEXITCODE -ne 0) { throw ($name+' failed') }
}
