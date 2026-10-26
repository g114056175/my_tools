$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$root=Join-Path $project 'src'
$out=Join-Path $project '.build/tests'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$clang=(Get-Command clang++ -ErrorAction Stop).Source
$flags=@('-std=c++20','-O2','-DUNICODE','-D_UNICODE','-DWINVER=0x0A00','-D_WIN32_WINNT=0x0A00','-I',$root,'-Wall','-Wextra','-Wpedantic','-static')
$libraries=@('-municode','-ld3d11','-ldxgi','-lole32','-luuid','-lmfplat','-lmfreadwrite','-lmfuuid','-lpropsys','-lshlwapi','-lshell32','-luser32','-lgdi32','-lkernel32')
foreach($name in @('gif_compression_smoke','dxgi_math_smoke','dxgi_live_smoke','recorder_visual_smoke','recording_limits_smoke','recording_names_smoke','save_dialog_smoke')) {
    $sources=@();$defines=@()
    if($name -eq 'gif_compression_smoke'){$sources=@('project1_region_recorder/gif_writer.cpp')}
    if($name -eq 'dxgi_live_smoke'){$sources=@('common/dxgi_capture.cpp')}
    if($name -eq 'recorder_visual_smoke'){$sources=@('common/dxgi_capture.cpp','project1_region_recorder/gif_writer.cpp','project1_region_recorder/region_selector.cpp')}
    if($name -eq 'recording_limits_smoke'){
        $sources=@('common/dxgi_capture.cpp','common/image_utils.cpp','project1_region_recorder/main.cpp','project1_region_recorder/mp4_writer.cpp','project1_region_recorder/gif_writer.cpp')
        $defines=@('-DLC_RECORDER_WORKER_TEST')
    }
    $exe=Join-Path $out ($name+'.exe')
    $arguments=$flags+$defines+@($sources|ForEach-Object{Join-Path $root $_})+@((Join-Path $PSScriptRoot ($name+'.cpp')),'-o',$exe)+$libraries
    & $clang @arguments
    if($LASTEXITCODE -ne 0){throw ($name+' compilation failed')}
    & $exe $out
    if($LASTEXITCODE -ne 0){throw ($name+' failed')}
    Write-Output ($name+': PASS')
}
