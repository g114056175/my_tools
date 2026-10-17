$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ui_native.ps1')
$project=Split-Path -Parent $PSScriptRoot
$source=Join-Path $project 'src'
$out=Join-Path $project '.build/tests'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$exe=Join-Path $out 'limit_notice_test_app.exe'
$sources=@('project1_region_recorder/recorder_ui.cpp','project1_region_recorder/region_selector.cpp',
    'project1_region_recorder/gif_writer.cpp','project1_region_recorder/mp4_writer.cpp')
$arguments=@('-std=c++20','-O2','-DUNICODE','-D_UNICODE','-DWINVER=0x0A00','-D_WIN32_WINNT=0x0A00',
    '-I',$source,'-Wall','-Wextra','-Wpedantic','-static','-municode','-mwindows')+
    @($sources|ForEach-Object{Join-Path $source $_})+@((Join-Path $PSScriptRoot 'limit_notice_test_app.cpp'),
    '-o',$exe,'-lole32','-luuid','-lmfplat','-lmfreadwrite','-lmfuuid','-lpropsys','-lshlwapi',
    '-lcomdlg32','-lcomctl32','-lshell32','-luser32','-lgdi32','-lgdiplus','-lkernel32')
& clang++ @arguments
if($LASTEXITCODE -ne 0){throw 'Limit notice test fixture compilation failed'}

function Require($okay,[string]$message){if(!$okay){throw $message}}
function Window-Text([IntPtr]$window){
    $text=[Text.StringBuilder]::new(4096)
    [void][CaptureUiNative]::SendBuffer($window,0x000D,[IntPtr]$text.Capacity,$text)
    return $text.ToString()
}
function Wait-SaveDialog([int]$ProcessId){
    for($i=0;$i -lt 120;$i++){
        $dialog=Find-TestWindow '#32770' $ProcessId
        if($dialog -ne [IntPtr]::Zero -and [CaptureUiNative]::FindChild($dialog,1001,'Edit') -ne [IntPtr]::Zero){return $dialog}
        Start-Sleep -Milliseconds 50
    }
    throw 'Save dialog did not open after acknowledgement'
}
$directory=Join-Path $env:TEMP ('LC-limit-notice-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$previousSettings=$env:LIGHTCAPTURE_SETTINGS_PATH
$previousScenario=$env:LIGHTCAPTURE_LIMIT_NOTICE_TEST
$app=$null;$main=[IntPtr]::Zero;$toolbar=[IntPtr]::Zero
try {
    $cases=@(
        @{Gif=1; Reason='size'; Auto=0; Limit='300 MB'; Kind='容量'; Cancel=$true},
        @{Gif=1; Reason='time'; Auto=0; Limit='1 分鐘'; Kind='時間'},
        @{Gif=0; Reason='size'; Auto=0; Limit='4 GB'; Kind='容量'},
        @{Gif=0; Reason='time'; Auto=0; Limit='30 分鐘'; Kind='時間'},
        @{Gif=1; Reason='size'; Auto=1; Limit='300 MB'; Kind='容量'},
        @{Gif=1; Reason='stopped'; Auto=0}
    )
    $number=0
    foreach($case in $cases){
        $number++;$folder=Join-Path $directory $number
        New-Item -ItemType Directory -Path $folder | Out-Null
        $settings=Join-Path $folder 'settings.ini'
        [IO.File]::WriteAllText($settings,"[Recorder]`r`nDirectory=$folder`r`nCopyOnFinish=0`r`nCaptureCursor=0`r`nGif=$($case.Gif)`r`nAutoSave=$($case.Auto)`r`nSelectKey=1914`r`n",[Text.Encoding]::Unicode)
        $env:LIGHTCAPTURE_SETTINGS_PATH=$settings
        $env:LIGHTCAPTURE_LIMIT_NOTICE_TEST=$case.Reason
        $app=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
        $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
        $env:LIGHTCAPTURE_LIMIT_NOTICE_TEST=$previousScenario
        $main=Wait-TestWindow 'LightRegionRecorderWindow' $app.Id $false
        $toolbar=Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id $false
        [void]$app.WaitForInputIdle(5000)
        [void][CaptureUiNative]::ShowWindow($main,5)
        [void](Wait-Control $main 105)
        Send-Command $main 105
        $selector=Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
        $vx=[CaptureUiNative]::GetSystemMetrics(76);$vy=[CaptureUiNative]::GetSystemMetrics(77)
        [void][CaptureUiNative]::SendMessage($selector,0x0201,[IntPtr]1,[CaptureUiNative]::Point((300-$vx),(200-$vy)))
        [void][CaptureUiNative]::SendMessage($selector,0x0200,[IntPtr]1,[CaptureUiNative]::Point((460-$vx),(320-$vy)))
        [void][CaptureUiNative]::SendMessage($selector,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point((460-$vx),(320-$vy)))
        [void](Wait-Control $toolbar 115);Send-Command $toolbar 115
        $format=if($case.Gif){'GIF'}else{'Video'}
        if($case.Reason -ne 'stopped'){
            $notice=Wait-TestWindow '#32770' $app.Id
            Require ((Window-Text $notice) -eq '錄製已自動停止') 'Limit notice must precede the save dialog'
            $script:noticeText=''
            [void][CaptureUiNative]::EnumChildWindows($notice,[CaptureUiNative+EnumCallback]{param($h,$p)
                $script:noticeText+=(Window-Text $h);return $true
            },[IntPtr]::Zero)
            Require ($script:noticeText.Contains("$format 錄製已達$($case.Kind)上限（$($case.Limit)）")) "Incorrect notice text: $script:noticeText"
            $action=if($case.Auto){'保存至預設位置'}else{'選擇保存位置'}
            Require ($script:noticeText.Contains($action)) 'Notice does not match auto-save preference'
            Require (![CaptureUiNative]::IsWindowEnabled($toolbar)) 'Toolbar must be disabled while the notice is open'
            Start-Sleep -Milliseconds 250
            Require (@(Get-ChildItem -LiteralPath $folder -Filter 'capture_*').Count -eq 0) 'Recording saved before acknowledgement'
            Require ([CaptureUiNative]::FindChild($notice,1001,'Edit') -eq [IntPtr]::Zero) 'Save picker opened before acknowledgement'
            [CaptureUiNative]::Snapshot($notice,(Join-Path $out "limit-notice-$format-$($case.Reason)-auto$($case.Auto).png"),$false)
            Send-Command $notice 1
        }
        $extension=if($case.Gif){'gif'}else{'mp4'}
        $saved=Join-Path $folder "capture_1.$extension"
        if(!$case.Auto){
            $dialog=Wait-SaveDialog $app.Id
            if($case.Cancel){
                Send-Command $dialog 2
                [void](Wait-Control $toolbar 122)
                Require (!(Test-Path -LiteralPath $saved)) 'Cancelled save created an output file'
                Send-Command $toolbar 122
                $dialog=Wait-SaveDialog $app.Id
            }
            Send-Command $dialog 1
        }
        for($i=0;$i -lt 100 -and !(Test-Path -LiteralPath $saved);$i++){Start-Sleep -Milliseconds 50}
        Require ((Test-Path -LiteralPath $saved) -and (Get-Item -LiteralPath $saved).Length -gt 100) 'Recording not saved after acknowledgement'
        Send-Command $main 202
        Require ($app.WaitForExit(5000)) 'Recorder did not exit cleanly'
        Write-Output ("$format $($case.Reason) auto=$($case.Auto): PASS")
        $app=$null
    }
} finally {
    $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
    $env:LIGHTCAPTURE_LIMIT_NOTICE_TEST=$previousScenario
    if($app -and !$app.HasExited){
        $dialog=Find-TestWindow '#32770' $app.Id
        if($dialog -ne [IntPtr]::Zero){Send-Command $dialog 2;Start-Sleep -Milliseconds 100}
        Send-Command $toolbar 123;Start-Sleep -Milliseconds 100
        Send-Command $main 202
        if(!$app.WaitForExit(3000)){Stop-Process -Id $app.Id -Force}
    }
    $resolved=[IO.Path]::GetFullPath($directory)
    if((Split-Path -Parent $resolved) -ne [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') -or !(Split-Path -Leaf $resolved).StartsWith('LC-limit-notice-')){throw 'Invalid test cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
