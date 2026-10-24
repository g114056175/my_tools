param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ui_native.ps1')
$Executable=(Resolve-Path -LiteralPath $Executable).Path
$directory=Join-Path $env:TEMP ('LC-shutdown-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$previousSettings=$env:LIGHTCAPTURE_SETTINGS_PATH
$app=$null;$main=[IntPtr]::Zero
function Click-Control([IntPtr]$Parent,[int]$Id) {
    $control=Wait-Control $Parent $Id
    if(![CaptureUiNative]::IsWindowEnabled($control)){throw "Disabled control: $Id"}
    [void][CaptureUiNative]::SendMessage($control,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
}
function Draw-Region([int]$X,[int]$Y,[int]$Width,[int]$Height) {
    Send-Command $main 105
    $selector=Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    $vx=[CaptureUiNative]::GetSystemMetrics(76);$vy=[CaptureUiNative]::GetSystemMetrics(77)
    foreach($step in @(@(0x0201,1,$X,$Y),@(0x0200,1,($X+$Width),($Y+$Height)),@(0x0202,0,($X+$Width),($Y+$Height)))) {
        [void][CaptureUiNative]::SendMessage($selector,$step[0],[IntPtr]$step[1],[CaptureUiNative]::Point(($step[2]-$vx),($step[3]-$vy)))
    }
    [void](Wait-Control $toolbar 115)
}
try {
    foreach($scenario in @('idle','ready','recording','paused','result','no-control-space')) {
        $settings=Join-Path $directory ($scenario+'.ini')
        [IO.File]::WriteAllText($settings,"[Recorder]`r`nCopyOnFinish=0`r`nAutoSave=0`r`nCaptureCursor=0`r`nGif=1`r`n",[Text.Encoding]::Unicode)
        $env:LIGHTCAPTURE_SETTINGS_PATH=$settings
        $app=Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
        $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
        $main=Wait-TestWindow 'LightRegionRecorderWindow' $app.Id $false
        [void][CaptureUiNative]::ShowWindow($main,5)
        [void](Wait-Control $main 105)
        $toolbar=Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id $false
        $before=@(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | ForEach-Object FullName)
        if($scenario -eq 'no-control-space') {
            Draw-Region ([CaptureUiNative]::GetSystemMetrics(76)) ([CaptureUiNative]::GetSystemMetrics(77)) ([CaptureUiNative]::GetSystemMetrics(78)) ([CaptureUiNative]::GetSystemMetrics(79))
            Click-Control $toolbar 115
            Start-Sleep -Milliseconds 150
            if([CaptureUiNative]::IsWindowVisible($toolbar) -or !(Get-ControlText $main 118).Contains('控制列沒有可放置空間')){throw 'Impossible control placement started an inaccessible recording'}
        } elseif($scenario -ne 'idle') {
            Draw-Region 300 200 160 120
            if($scenario -ne 'ready') {
                Click-Control $toolbar 115
                [void](Wait-Control $toolbar 117)
                [uint32]$affinity=0
                if(![CaptureUiNative]::GetWindowDisplayAffinity($toolbar,[ref]$affinity) -or $affinity -ne 0){throw 'Recording controls are hidden from external display'}
                Start-Sleep -Milliseconds 900
                $path=Join-Path $directory ($scenario+'-toolbar.png')
                [CaptureUiNative]::SnapshotUnrefreshed($toolbar,$path)
                $image=[Drawing.Bitmap]::FromFile($path)
                try {
                    $visible=0;$stop=0
                    for($y=0;$y -lt $image.Height;$y++){for($x=0;$x -lt $image.Width;$x++){
                        $pixel=$image.GetPixel($x,$y)
                        if($pixel.R+$pixel.G+$pixel.B -gt 45){$visible++}
                        if($x -lt 36 -and $pixel.R -gt 160 -and $pixel.R-$pixel.G -gt 55){$stop++}
                    }}
                    if($visible -lt $image.Width*$image.Height/2 -or $stop -lt 10){throw 'Recording toolbar or actual stop icon is invisible'}
                } finally {$image.Dispose()}
                if($scenario -eq 'paused'){Click-Control $toolbar 116}
                if($scenario -eq 'result') {
                    Click-Control $toolbar 117
                    $saveDialog=Wait-TestWindow '#32770' $app.Id
                    Send-Command $saveDialog 2
                    [void](Wait-Control $toolbar 122)
                }
            }
        }
        $created=@(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | Where-Object FullName -notin $before | ForEach-Object FullName)
        if($scenario -in @('recording','paused','result') -and $created.Count -ne 1){throw 'Expected exactly one owned temporary recording'}
        if($scenario -eq 'no-control-space' -and $created.Count){throw 'Rejected selection created a recording file'}
        Send-Command $main 201
        [void][CaptureUiNative]::PostMessage($main,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
        if($scenario -in @('recording','paused')) {
            $confirmation=Wait-TestWindow '#32770' $app.Id
            Send-Command $confirmation 6
        }
        if(!$app.WaitForExit(5000)){throw "Main X left a background recorder running: $scenario PID=$($app.Id)"}
        if(Get-Process -Id $app.Id -ErrorAction SilentlyContinue){throw 'Closed recorder process still exists'}
        foreach($path in $created){if(Test-Path -LiteralPath $path){throw "Closed recorder retained its temporary output: $scenario"}}
        Write-Output ($scenario+' actual-controls=PASS main-close=PASS process-exited=PASS temporary-cleanup=PASS')
        $main=[IntPtr]::Zero
    }
} finally {
    $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
    if($app -and !$app.HasExited){Stop-Process -Id $app.Id -Force}
    $resolved=(Resolve-Path -LiteralPath $directory).Path
    if((Split-Path -Parent $resolved) -ne (Resolve-Path -LiteralPath $env:TEMP).Path -or !(Split-Path -Leaf $resolved).StartsWith('LC-shutdown-')){throw 'Unexpected test cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
