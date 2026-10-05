param([string]$Executable = '')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'ui_native.ps1')
$root=Split-Path -Parent $PSScriptRoot
if(!$Executable) {
 $Executable=Join-Path $root 'build/region_recorder.exe'
 if(!(Test-Path -LiteralPath $Executable)){$Executable=Join-Path $root 'region_recorder.exe'}
}
$Executable=(Resolve-Path -LiteralPath $Executable).Path
$directory=Join-Path $env:TEMP ('LC-save-test-'+[guid]::NewGuid().ToString('N'))
$a=Join-Path $directory 'a'; $b=Join-Path $directory 'b'
New-Item -ItemType Directory -Path $directory,$a,$b | Out-Null
$settings=Join-Path $directory 'settings.ini'
[IO.File]::WriteAllText($settings,"[Recorder]`r`nDirectory=$a`r`nCopyOnFinish=0`r`nCaptureCursor=0`r`nGif=1`r`n",[Text.Encoding]::Unicode)
[IO.File]::WriteAllText((Join-Path $b 'capture_1.gif'),'existing-1')
[IO.File]::WriteAllText((Join-Path $b 'capture_9999.gif'),'existing-9999')
$previous=$env:LIGHTCAPTURE_SETTINGS_PATH
$env:LIGHTCAPTURE_SETTINGS_PATH=$settings
$app=Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
$env:LIGHTCAPTURE_SETTINGS_PATH=$previous
$main=[IntPtr]::Zero
function Require($okay,[string]$message){if(!$okay){throw $message}}
function Edit-Handle([IntPtr]$dialog){
    $edit=[CaptureUiNative]::FindChild($dialog,1001,'Edit')
    Require ($edit -ne [IntPtr]::Zero) 'Filename edit missing'
    return $edit
}
function Name-Text([IntPtr]$dialog){
    $text=[Text.StringBuilder]::new(32768)
    [void][CaptureUiNative]::SendBuffer((Edit-Handle $dialog),0x000D,[IntPtr]$text.Capacity,$text)
    return $text.ToString()
}
function Expect-Name([IntPtr]$dialog,[string]$name){
    for($i=0;$i -lt 60;$i++){if((Name-Text $dialog) -eq $name){return};Start-Sleep -Milliseconds 50}
    throw "Unexpected suggestion: $(Name-Text $dialog), expected $name"
}
function Record-Clip([bool]$automatic){
    Send-Command $main 201; [void](Wait-Control $main 105)
    [void][CaptureUiNative]::SetForegroundWindow($main)
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,114),0x00F1,[IntPtr]([int]$automatic),[IntPtr]::Zero)
    Send-Command $main 114; Send-Command $main 105
    $selector=Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    [void][CaptureUiNative]::SetForegroundWindow($selector)
    $vx=[CaptureUiNative]::GetSystemMetrics(76);$vy=[CaptureUiNative]::GetSystemMetrics(77)
    [void][CaptureUiNative]::SendMessage($selector,0x0201,[IntPtr]1,[CaptureUiNative]::Point((300-$vx),(200-$vy)))
    [void][CaptureUiNative]::SendMessage($selector,0x0200,[IntPtr]1,[CaptureUiNative]::Point((460-$vx),(320-$vy)))
    [void][CaptureUiNative]::SendMessage($selector,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point((460-$vx),(320-$vy)))
    [void](Wait-Control $toolbar 115);Send-Command $toolbar 115
    [void](Wait-Control $toolbar 117);Start-Sleep -Milliseconds 700
    Send-Command $toolbar 117
}
function Expect-File([string]$path){
    for($i=0;$i -lt 100 -and !(Test-Path -LiteralPath $path);$i++){Start-Sleep -Milliseconds 50}
    Require ((Test-Path -LiteralPath $path) -and (Get-Item -LiteralPath $path).Length -gt 100) "Saved recording missing: $path"
    Start-Sleep -Milliseconds 150
}
try {
    $main=Wait-TestWindow 'LightRegionRecorderWindow' $app.Id $false
    $toolbar=Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id $false
    Record-Clip $false
    $dialog=Wait-TestWindow '#32770' $app.Id;Expect-Name $dialog 'capture_1.gif'
    Send-Command $dialog 2;[void](Wait-Control $toolbar 122)
    Send-Command $toolbar 122
    $dialog=Wait-TestWindow '#32770' $app.Id;Expect-Name $dialog 'capture_1.gif'
    Expect-Name $dialog 'capture_1.gif'
    Send-Command $dialog 1;Expect-File (Join-Path $a 'capture_1.gif')
    Require ([IO.File]::ReadAllText((Join-Path $b 'capture_1.gif')) -eq 'existing-1') 'Existing recording overwritten'
    Write-Output 'Manual numbered suggestion and cancelled save: PASS'

    Record-Clip $false
    $dialog=Wait-TestWindow '#32770' $app.Id;Expect-Name $dialog 'capture_2.gif'
    [void][CaptureUiNative]::SendText((Edit-Handle $dialog),0x000C,[IntPtr]::Zero,'my clip.gif')
    Expect-Name $dialog 'my clip.gif'
    Send-Command $dialog 1;Expect-File (Join-Path $a 'my clip.gif')
    Write-Output 'Explicit user filename preserved: PASS'

    Record-Clip $true;Expect-File (Join-Path $a 'capture_2.gif')
    Record-Clip $true;Expect-File (Join-Path $a 'capture_3.gif')
    [IO.File]::WriteAllText((Join-Path $a 'capture_4.gif'),'collision')
    [IO.File]::WriteAllText((Join-Path $a 'capture_777.gif'),'high suffix')
    Record-Clip $true;Expect-File (Join-Path $a 'capture_778.gif')
    Require ([IO.File]::ReadAllText((Join-Path $a 'capture_4.gif')) -eq 'collision') 'Auto-save overwrote collision'
    Write-Output 'Auto-save numbered sequence and external collision: PASS'

    Record-Clip $false
    $dialog=Wait-TestWindow '#32770' $app.Id;Expect-Name $dialog 'capture_779.gif'
    [IO.File]::WriteAllText((Join-Path $a 'capture_779.gif'),'late collision')
    [IO.File]::WriteAllText((Join-Path $a 'capture_9999.gif'),'new high suffix')
    Send-Command $dialog 1;Expect-Name $dialog 'capture_10000.gif'
    Send-Command $dialog 1;Expect-File (Join-Path $a 'capture_10000.gif')
    Require ([IO.File]::ReadAllText((Join-Path $a 'capture_779.gif')) -eq 'late collision') 'Late collision overwritten'
    Write-Output 'Collision during manual save refreshes suggestion without overwrite: PASS'
} finally {
    if($main -ne [IntPtr]::Zero -and !$app.HasExited) {
        $dialog=Find-TestWindow '#32770' $app.Id
        if($dialog -ne [IntPtr]::Zero){Send-Command $dialog 2;Start-Sleep -Milliseconds 100}
        Send-Command $toolbar 123;Start-Sleep -Milliseconds 100
        Send-Command $main 202
        if(!$app.WaitForExit(3000)){Stop-Process -Id $app.Id -Force}
    }
    $resolved=(Resolve-Path -LiteralPath $directory).Path
    if((Split-Path -Parent $resolved) -ne (Resolve-Path -LiteralPath $env:TEMP).Path -or !(Split-Path -Leaf $resolved).StartsWith('LC-save-test-')){throw 'Invalid test cleanup path'}
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
