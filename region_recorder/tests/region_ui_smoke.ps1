param([string]$Executable = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ui_native.ps1')
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing @'
using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
public static class RecorderClipboardTest {
    static DataObject backup;
    static bool backedUp;
    public static void Backup() {
        backup = new DataObject();
        var source = Clipboard.GetDataObject();
        if (source != null) foreach (var format in source.GetFormats(false)) {
            var value = source.GetData(format, false);
            var bitmap = value as Bitmap;
            var stream = value as MemoryStream;
            if (bitmap != null) value = bitmap.Clone();
            if (stream != null) value = new MemoryStream(stream.ToArray());
            if (value != null) backup.SetData(format, false, value);
        }
        backedUp = true;
    }
    public static bool Contains(string path) {
        var files = Clipboard.GetFileDropList();
        return files.Count == 1 && string.Equals(files[0], path, StringComparison.OrdinalIgnoreCase);
    }
    public static void SetSentinel() { Clipboard.SetText("LightCapture clipboard preservation test"); }
    public static bool HasSentinel() { return Clipboard.ContainsText() && Clipboard.GetText()=="LightCapture clipboard preservation test"; }
    public static void Restore() {
        if (!backedUp) return;
        Clipboard.SetDataObject(backup, true, 5, 100);
        backedUp = false;
    }
}
'@
$root = Split-Path -Parent $PSScriptRoot
if(!$Executable) {
    $Executable=Join-Path $root 'build/region_recorder.exe'
    if(!(Test-Path -LiteralPath $Executable)){$Executable=Join-Path $root 'region_recorder.exe'}
}
$Executable=(Resolve-Path -LiteralPath $Executable).Path
$screenshots = Join-Path $root 'build\review'
[void](New-Item -ItemType Directory -Force -Path $screenshots)
$outputDirectory = Join-Path $env:TEMP ('region_ui_smoke_' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $outputDirectory)
$testTemporaryPaths = @()
$previousSettings = $env:LIGHTCAPTURE_SETTINGS_PATH
$env:LIGHTCAPTURE_SETTINGS_PATH = Join-Path $outputDirectory 'settings.ini'
$app = Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
$env:LIGHTCAPTURE_SETTINGS_PATH = $previousSettings
$main = [IntPtr]::Zero
$toolbar = [IntPtr]::Zero
function Get-Region {
    $marker=Find-TestWindow 'LightCaptureRegionMarker' $app.Id
    if($marker -eq [IntPtr]::Zero -or ![CaptureUiNative]::IsWindowVisible($marker)){return @()}
    $rect=Get-TestRect $marker
    return @(($rect[0]+3),($rect[1]+3),($rect[2]-6),($rect[3]-6))
}
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if (($Actual -join ',') -ne ($Expected -join ',')) { throw "$Message expected=$($Expected -join ',') actual=$($Actual -join ',')" }
}
function Assert-Excluded([IntPtr]$Window) {
    [uint32]$affinity=0
    if (![CaptureUiNative]::GetWindowDisplayAffinity($Window,[ref]$affinity) -or $affinity -ne 0x11) {
        throw "Recording overlay is not excluded from capture: affinity=$affinity error=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()) window=$Window"
    }
}
function Assert-VisibleToCapture([IntPtr]$Window) {
    [uint32]$affinity=0
    if (![CaptureUiNative]::GetWindowDisplayAffinity($Window,[ref]$affinity) -or $affinity -ne 0) {
        throw "Ready/result overlay is excluded from screenshots: affinity=$affinity"
    }
}
function Check-ToolbarPixels([string]$Name) {
    Assert-VisibleToCapture $toolbar
    $path=Join-Path $screenshots $Name
    [CaptureUiNative]::SnapshotUnrefreshed($toolbar,$path)
    $image=[Drawing.Bitmap]::FromFile($path)
    try {
        $visible=0;$accent=0;$close=0;$ink=0
        for($y=0;$y -lt $image.Height;$y++) {
            for($x=0;$x -lt $image.Width;$x++) {
                $color=$image.GetPixel($x,$y)
                if($color.R+$color.G+$color.B -gt 45){$visible++}
                if($color.B -gt 160 -and $color.B-$color.R -gt 45){$accent++}
                if($color.R -gt 160 -and $color.R-$color.G -gt 55){$close++}
                if($color.R -gt 180 -and $color.G -gt 180 -and $color.B -gt 180){$ink++}
            }
        }
        $ready=[CaptureUiNative]::IsWindowVisible([CaptureUiNative]::GetDlgItem($toolbar,115))
        if($visible -lt $image.Width*$image.Height/2 -or ($ready -and $accent -lt 50) -or (!$ready -and $ink -lt 10) -or $close -lt 5) {
            throw "Floating controls are black/empty: visible=$visible accent=$accent close=$close ink=$ink"
        }
    } finally {$image.Dispose()}
}
function Check-NoFrame {
    $marker = Find-TestWindow 'LightCaptureRegionMarker' $app.Id
    if ($marker -ne [IntPtr]::Zero -and [CaptureUiNative]::IsWindowVisible($marker)) { throw 'Unexpected idle marker' }
    if ([CaptureUiNative]::IsWindowVisible($toolbar)) { throw 'Unexpected idle toolbar' }
}
function Select-Region([int]$Left, [int]$Top, [int]$Width, [int]$Height, [bool]$Live = $false) {
    if ([CaptureUiNative]::GetWindowLong([CaptureUiNative]::GetDlgItem($toolbar,117),-16) -band 0x10000000) {
        Send-Command $toolbar 121
    } else {
        Send-Command $main 201
        [void](Wait-Control $main 105)
        [void][CaptureUiNative]::SetForegroundWindow($main)
        Send-Command $main 105
    }
    $selector = Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    [void][CaptureUiNative]::SetForegroundWindow($selector)
    $vx=[CaptureUiNative]::GetSystemMetrics(76);$vy=[CaptureUiNative]::GetSystemMetrics(77)
    [void][CaptureUiNative]::SendMessage($selector,0x0201,[IntPtr]1,[CaptureUiNative]::Point(($Left-$vx),($Top-$vy)))
    [void][CaptureUiNative]::SendMessage($selector,0x0200,[IntPtr]1,[CaptureUiNative]::Point(($Left+$Width-$vx),($Top+$Height-$vy)))
    if ($Live) {
        if (![CaptureUiNative]::IsWindowVisible($selector)) { throw 'Live selection overlay is hidden' }
        foreach ($point in @(@(($Left+1),($Top+[int]($Height/2))),@(($Left+[int]($Width/2)),($Top+1)),
                            @(($Left+$Width-2),($Top+[int]($Height/2))),@(($Left+[int]($Width/2)),($Top+$Height-2)))) {
            $pixel = [CaptureUiNative]::ScreenPixel($point[0],$point[1])
            if ($pixel.R -gt 12 -or [Math]::Abs($pixel.G-210) -gt 12 -or [Math]::Abs($pixel.B-255) -gt 12) {
                throw "Live selection border missing: $pixel"
            }
        }
    }
    [void][CaptureUiNative]::SendMessage($selector,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point(($Left+$Width-$vx),($Top+$Height-$vy)))
    [void](Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id)
    Start-Sleep -Milliseconds 100
    Assert-Equal (Get-Region) @($Left,$Top,$Width,$Height) 'Selection physical coordinates'
}
function Check-ShortcutBlocked {
    if (![CaptureUiNative]::HotkeyAvailable(3,116)) { throw 'Selection shortcut remains registered during capture workflow' }
    [void][CaptureUiNative]::PostMessage($main,0x0312,[IntPtr]1,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    if ((Find-TestWindow 'LightCaptureRegionSelector' $app.Id) -ne [IntPtr]::Zero) { throw 'Shortcut interrupted capture workflow' }
}
function Check-Marker([int[]]$Region) {
    $marker = Wait-TestWindow 'LightCaptureRegionMarker' $app.Id
    Assert-Equal (Get-TestRect $marker) @(($Region[0]-3),($Region[1]-3),($Region[2]+6),($Region[3]+6)) 'Marker coordinates'
    Start-Sleep -Milliseconds 200
    Assert-VisibleToCapture $marker
    Assert-VisibleToCapture $toolbar
    foreach($point in @(@(($Region[0]-2),($Region[1]+$Region[3]/2)),@(($Region[0]+$Region[2]/2),($Region[1]-2)))) {
        $pixel=[CaptureUiNative]::ScreenPixel($point[0],$point[1])
        if($pixel.R -gt 12 -or [Math]::Abs($pixel.G-210) -gt 12 -or [Math]::Abs($pixel.B-255) -gt 12) {throw "Visible border missing: $pixel"}
    }
    $position = Get-TestRect $toolbar
    if ($position[0] -lt $Region[0]+$Region[2] -and $position[0]+$position[2] -gt $Region[0] -and
        $position[1] -lt $Region[1]+$Region[3] -and $position[1]+$position[3] -gt $Region[1]) { throw 'Toolbar overlaps ROI' }
}
function Start-Clip([bool]$Gif) {
    Send-Command $main $(if ($Gif) {127} else {109})
    $before = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | ForEach-Object FullName)
    $destinationsBefore = @(Get-ChildItem -LiteralPath $outputDirectory -File | ForEach-Object FullName)
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($toolbar,115),0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    [void](Wait-Control $toolbar 117)
    if (![CaptureUiNative]::IsWindowEnabled([CaptureUiNative]::GetDlgItem($toolbar,117))) { throw 'Recording stop button is disabled' }
    $newPaths = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File |
        Where-Object { $_.FullName -notin $before } | ForEach-Object FullName)
    if ($newPaths.Count -ne 1) { throw 'Expected one staged recording' }
    $script:testTemporaryPaths += $newPaths
    if ([CaptureUiNative]::IsWindowVisible($main)) { throw 'Main settings did not hide to tray' }
    if (@(Get-ChildItem -LiteralPath $outputDirectory -File | Where-Object { $_.FullName -notin $destinationsBefore }).Count) { throw 'Recording wrote into destination prematurely' }
    Start-Sleep -Milliseconds 1400
    return $newPaths[0]
}
function Check-File([string]$Path,[bool]$Gif) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($Gif) {
        if ([Text.Encoding]::ASCII.GetString($bytes,0,3) -ne 'GIF') { throw 'Invalid GIF output' }
        Assert-Equal @([BitConverter]::ToUInt16($bytes,6),[BitConverter]::ToUInt16($bytes,8)) @(160,120) 'Resized recording changed encoder canvas'
        $image=[Drawing.Image]::FromFile($Path)
        try {
            $delayBytes=$image.GetPropertyItem(0x5100).Value
            $delays=@(for ($offset=0;$offset -lt $delayBytes.Length;$offset+=4) { [BitConverter]::ToInt32($delayBytes,$offset) })
            if ($delays.Count -lt 3 -or 4 -notin $delays -or 5 -notin $delays) { throw 'GIF 24 FPS rounding was not distributed across frames' }
        } finally { $image.Dispose() }
    } elseif ([Text.Encoding]::ASCII.GetString($bytes,4,4) -ne 'ftyp') { throw 'Invalid MP4 output' }
}
try {
    [RecorderClipboardTest]::Backup()
    $main = Wait-TestWindow 'LightRegionRecorderWindow' $app.Id $false
    Start-Sleep -Milliseconds 250
    [void][CaptureUiNative]::ShowWindow($main,5)
    [void][CaptureUiNative]::SetForegroundWindow($main)
    # Wait for the initial DWM show animation, not a repair repaint. Otherwise
    # desktop snapshots can contain a fading mixture with the window behind it.
    Start-Sleep -Milliseconds 250
    [void](Wait-Control $main 105)
    $toolbar = Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id $false
    # Compare an incremental label update with a clean paint. The snapshot
    # deliberately does not repair the window before checking old glyphs.
    $status=[CaptureUiNative]::GetDlgItem($main,118)
    Set-ControlText $main 118 '長狀態文字 ABCDEFGHIJKLMNOPQRSTUVWXYZ 1234567890'
    Set-ControlText $main 118 '短訊息'
    $warm=Join-Path $screenshots 'status-incremental.png'
    $clean=Join-Path $screenshots 'status-clean.png'
    [CaptureUiNative]::SnapshotUnrefreshed($status,$warm)
    [CaptureUiNative]::Snapshot($status,$clean,$true)
    $a=[Drawing.Bitmap]::FromFile($warm);$b=[Drawing.Bitmap]::FromFile($clean)
    try {
        for($y=0;$y -lt $a.Height;$y++) {for($x=0;$x -lt $a.Width;$x++) {
            if($a.GetPixel($x,$y).ToArgb() -ne $b.GetPixel($x,$y).ToArgb()){throw 'Status label leaves old glyphs until a forced repaint'}
        }}
    } finally {$a.Dispose();$b.Dispose()}
    $previousSettings=$env:LIGHTCAPTURE_SETTINGS_PATH
    $env:LIGHTCAPTURE_SETTINGS_PATH=Join-Path $outputDirectory 'settings.ini'
    $duplicate=Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
    $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
    if (!$duplicate.WaitForExit(3000)) { Stop-Process -Id $duplicate.Id -Force; throw 'Duplicate recorder instance was allowed' }
    Check-NoFrame
    if ([CaptureUiNative]::GetDlgItem($main,115) -ne [IntPtr]::Zero) { throw 'Main panel still has Start button' }
    Assert-Equal (Get-ControlText $main 107) '60' 'Default Video FPS'
    Assert-Equal (Get-ControlText $main 128) '24' 'Default GIF FPS'
    foreach($id in 101..104){if([CaptureUiNative]::GetDlgItem($main,$id) -ne [IntPtr]::Zero){throw 'Coordinate input still exists'}}
    Assert-Equal (Get-ControlText $main 111) ([CaptureUiNative]::DownloadsPath()) 'Default directory is not current user Downloads'
    Assert-Equal ([CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,114),0x00F0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) 0 'Auto-save defaults off'
    Assert-Equal ([CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,131),0x00F0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) 1 'Copy defaults on'
    Assert-Equal (Get-ControlText $toolbar 132) 'GIF' 'Default format is GIF'
    Assert-Equal ([CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,135),0x00F0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) 1 'Cursor capture defaults on'
    [CaptureUiNative]::Snapshot($main,(Join-Path $screenshots 'recorder-setup.png'),$false)
    Set-ControlText $main 111 $outputDirectory
    $before = Get-Region
    foreach ($entry in @(@(114,54,309),@(131,360,309),@(135,230,108))) {
        $switch=[CaptureUiNative]::GetDlgItem($main,$entry[0])
        $state=[CaptureUiNative]::SendMessage($switch,0x00F0,[IntPtr]::Zero,[IntPtr]::Zero)
        [void][CaptureUiNative]::SendMessage($main,0x0201,[IntPtr]1,[CaptureUiNative]::Point($entry[1],$entry[2]))
        [void][CaptureUiNative]::SendMessage($main,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point($entry[1],$entry[2]))
        Assert-Equal ([CaptureUiNative]::SendMessage($switch,0x00F0,[IntPtr]::Zero,[IntPtr]::Zero)) $state 'Toggle label should not change switch'
        [void][CaptureUiNative]::SendMessage($switch,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
        if ([CaptureUiNative]::SendMessage($switch,0x00F0,[IntPtr]::Zero,[IntPtr]::Zero) -eq $state) { throw 'Switch itself did not toggle' }
        [void][CaptureUiNative]::SendMessage($switch,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    }
    [void][CaptureUiNative]::ShowWindow($main,6)
    Start-Sleep -Milliseconds 100
    if (![CaptureUiNative]::IsWindowVisible($main) -or ![CaptureUiNative]::IsIconic($main)) { throw 'Minimize should retain the taskbar window' }
    Send-Command $main 201
    [void](Wait-Control $main 133)
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,133),0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    if ([CaptureUiNative]::IsWindowVisible($main)) { throw 'Explicit collapse did not hide the settings window' }
    [CaptureUiNative]::Hotkey(82,[byte[]]@(17,16))
    $selector = Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    [void][CaptureUiNative]::PostMessage($selector,0x0100,[IntPtr]27,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    Assert-Equal (Get-Region) $before 'Selector cancel changed coordinates'
    Check-NoFrame
    # Verify actual OS registration while editing without sending desktop-wide
    # typing into a control that can lose foreground focus to unrelated input.
    Send-Command $main 201
    [void](Wait-Control $main 129)
    [void][CaptureUiNative]::SetForegroundWindow($main)
    $selectKey=[CaptureUiNative]::GetDlgItem($main,129)
    [void][CaptureUiNative]::SendMessage($selectKey,0x0201,[IntPtr]1,[CaptureUiNative]::Point(20,18))
    [void][CaptureUiNative]::SendMessage($selectKey,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point(20,18))
    Assert-Equal ([CaptureUiNative]::FocusedWindow($main)) $selectKey 'Hotkey edit did not receive focus'
    if (![CaptureUiNative]::HotkeyAvailable(6,82)) { throw 'Global shortcuts remained registered during editing' }
    [void][CaptureUiNative]::PostMessage($main,0x0312,[IntPtr]1,[IntPtr]::Zero)
    [void][CaptureUiNative]::SendMessage($selectKey,0x0401,[IntPtr]::Zero,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 700
    Check-NoFrame
    if ((Find-TestWindow 'LightCaptureRegionSelector' $app.Id) -ne [IntPtr]::Zero) { throw 'Editing hotkey triggered selection' }
    Assert-Equal ([CaptureUiNative]::SendMessage($selectKey,0x0402,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) 0 'Incomplete edit was committed before focus left'
    foreach ($key in @(17,18,116)) {
        [void][CaptureUiNative]::PostMessage($selectKey,0x0100,[IntPtr]$key,[IntPtr]::Zero)
    }
    foreach ($key in @(116,18,17)) {
        [void][CaptureUiNative]::PostMessage($selectKey,0x0101,[IntPtr]$key,[IntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 150
    Assert-Equal ([CaptureUiNative]::SendMessage($selectKey,0x0402,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) (0x0674) 'Capturing Ctrl+Alt+F5'
    Assert-Equal ([CaptureUiNative]::CaretWindow($main)) ([IntPtr]::Zero) 'Hotkey input has a native text caret'
    if ([CaptureUiNative]::GetDlgItem($main,130) -ne [IntPtr]::Zero) { throw 'Stop hotkey should be removed' }
    [void][CaptureUiNative]::SendMessage($main,0x0201,[IntPtr]1,[CaptureUiNative]::Point(24,90))
    [void][CaptureUiNative]::SendMessage($main,0x0202,[IntPtr]::Zero,[CaptureUiNative]::Point(24,90))
    Start-Sleep -Milliseconds 100
    if([CaptureUiNative]::FocusedWindow($main) -eq $selectKey){throw 'Clicking blank UI did not finish shortcut editing'}
    if ([CaptureUiNative]::HotkeyAvailable(3,116)) { throw 'Edited shortcuts were not registered after leaving the fields' }
    if (!(Get-ControlText $main 118).Contains('已設定框選熱鍵')) { throw 'Successful shortcut edit has no confirmation' }
    # Non-interactive labels do not send BN_CLICKED; their queued clicks must
    # still finish editing without firing the global selection shortcut.
    [void][CaptureUiNative]::SendMessage($selectKey,0x0201,[IntPtr]1,[CaptureUiNative]::Point(20,18))
    [void][CaptureUiNative]::PostMessage([CaptureUiNative]::GetDlgItem($main,118),0x0201,[IntPtr]1,[CaptureUiNative]::Point(8,8))
    Start-Sleep -Milliseconds 100
    if([CaptureUiNative]::FocusedWindow($main) -eq $selectKey){throw 'Clicking a static label did not finish shortcut editing'}
    if([CaptureUiNative]::HotkeyAvailable(3,116)){throw 'Label click did not resume the configured shortcut'}
    [CaptureUiNative]::Hotkey(116,[byte[]]@(17,18))
    $selector = Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    [void][CaptureUiNative]::PostMessage($selector,0x0100,[IntPtr]27,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 100
    if ([CaptureUiNative]::GetSystemMetrics(76) -le -160) {
        Select-Region -160 200 320 120 $true
        Check-Marker @(-160,200,320,120)
        Send-Command $toolbar 120
        Start-Sleep -Milliseconds 100
        Assert-Equal (Get-Region) $before 'Cross-monitor cancel changed prior region'
        Write-Output 'Cross-monitor mouse selection and cancel: PASS'
    }
    Select-Region 300 200 160 120 $true
    Check-Marker @(300,200,160,120)
    Check-ShortcutBlocked
    Check-ToolbarPixels 'recorder-ready.png'
    Send-Command $main 201
    [void](Wait-Control $main 105)
    [void][CaptureUiNative]::ShowWindow($main,6)
    Start-Sleep -Milliseconds 100
    if (![CaptureUiNative]::IsWindowVisible($toolbar)) { throw 'Minimizing settings hid the ready toolbar' }
    Send-Command $main 201
    [void](Wait-Control $main 105)
    Send-Command $main 114
    Start-Sleep -Milliseconds 100
    Check-Marker @(300,200,160,120)
    [void][CaptureUiNative]::PostMessage($main,0x0312,[IntPtr]3,[IntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    Check-NoFrame
    Assert-Equal (Get-Region) $before 'Ready cancel offset the previous coordinates'
    Select-Region 300 200 160 120
    $staged = Start-Clip $true
    Check-Marker @(300,200,160,120)
    Check-ShortcutBlocked
    Assert-Equal ((Get-TestRect $toolbar)[2..3]) @(252,42) 'Compact recording toolbar'
    [void](Wait-Control $toolbar 120)
    Send-Command $toolbar 120
    $confirmation = Wait-TestWindow '#32770' $app.Id
    Send-Command $confirmation 7
    Start-Sleep -Milliseconds 100
    [void](Wait-Control $toolbar 117)
    Check-ToolbarPixels 'recorder-recording.png'
    Send-Command $main 201
    [void](Wait-Control $main 133)
    $field=Get-TestRect ([CaptureUiNative]::GetDlgItem($main,107))
    $pixel=[CaptureUiNative]::ScreenPixel(($field[0]+$field[2]-2),($field[1]+2))
    if($pixel.R -ne 14 -or $pixel.G -ne 19 -or $pixel.B -ne 27){throw "Disabled edit has wrong background: $pixel"}
    [void][CaptureUiNative]::ShowWindow($main,6)
    Start-Sleep -Milliseconds 100
    if (![CaptureUiNative]::IsWindowVisible($toolbar)) { throw 'Minimizing settings hid the recording toolbar' }
    $time = Get-ControlText $toolbar 126
    [void][CaptureUiNative]::PostMessage($toolbar,0x0100,[IntPtr]27,[IntPtr]::Zero)
    [void][CaptureUiNative]::PostMessage($main,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    $confirmation=Wait-TestWindow '#32770' $app.Id
    Send-Command $confirmation 7
    Start-Sleep -Milliseconds 400
    if ((Get-ControlText $toolbar 126) -eq $time) { throw 'Escape/declined close stopped recording' }
    Send-Command $toolbar 121
    $selector = Wait-TestWindow 'LightCaptureRegionSelector' $app.Id
    [void][CaptureUiNative]::PostMessage($selector,0x0100,[IntPtr]27,[IntPtr]::Zero)
    [void](Wait-Control $toolbar 116)
    Start-Sleep -Milliseconds 250
    $paused = Get-ControlText $toolbar 126
    Start-Sleep -Milliseconds 400
    Assert-Equal (Get-ControlText $toolbar 126) $paused 'Resize cancel resumed recording'
    Assert-Equal (Get-Region) @(300,200,160,120) 'Resize cancel moved ROI'
    Select-Region 380 240 240 160
    Start-Sleep -Milliseconds 250
    Check-ShortcutBlocked
    Assert-Equal (Get-ControlText $toolbar 116) '繼續' 'Resize accept should stay paused'
    Check-Marker @(380,240,240,160)
    Send-Command $toolbar 116
    Start-Sleep -Milliseconds 500
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($toolbar,117),0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
    $saveDialog = Wait-TestWindow '#32770' $app.Id
    $suggestedText=[Text.StringBuilder]::new(1024)
    for($attempt=0;$attempt -lt 60;++$attempt) {
        $suggestion = [CaptureUiNative]::FindChild($saveDialog,1001,'Edit')
        [void]$suggestedText.Clear()
        if($suggestion -ne [IntPtr]::Zero){[void][CaptureUiNative]::SendBuffer($suggestion,0x000D,[IntPtr]1024,$suggestedText)}
        if($suggestedText.ToString() -eq 'capture_1.gif'){break}
        Start-Sleep -Milliseconds 50
    }
    Assert-Equal $suggestedText.ToString() 'capture_1.gif' 'Manual save did not suggest numbered name'
    Send-Command $saveDialog 2
    [void](Wait-Control $toolbar 122)
    if (!(Test-Path -LiteralPath $staged)) { throw 'Cancel save lost temporary output' }
    if (![RecorderClipboardTest]::Contains($staged)) { throw 'Unstored recording should be copied from its temporary file by default' }
    Check-ShortcutBlocked
    Check-ToolbarPixels 'recorder-unsaved.png'
    Send-Command $toolbar 122
    $saveDialog = Wait-TestWindow '#32770' $app.Id
    [void](Wait-Control $saveDialog 1)
    Start-Sleep -Milliseconds 100
    $fileEdit = [CaptureUiNative]::FindChild($saveDialog,1001,'Edit')
    if ($fileEdit -eq [IntPtr]::Zero) { throw 'Save dialog filename edit not found' }
    # Accept the generated filename without typing a suffix.
    Send-Command $saveDialog 1
    for ($attempt=0;$attempt -lt 100 -and !(Test-Path -LiteralPath (Join-Path $outputDirectory 'capture_1.gif'));++$attempt) { Start-Sleep -Milliseconds 50 }
    Check-File (Join-Path $outputDirectory 'capture_1.gif') $true
    Check-NoFrame
    if (Test-Path -LiteralPath $staged) { throw 'Saved output did not leave staging' }
    for ($attempt=0;$attempt -lt 40 -and ![RecorderClipboardTest]::Contains((Join-Path $outputDirectory 'capture_1.gif'));++$attempt) { Start-Sleep -Milliseconds 25 }
    if (![RecorderClipboardTest]::Contains((Join-Path $outputDirectory 'capture_1.gif'))) {
        throw "Save clipboard mismatch: actual=$([Windows.Forms.Clipboard]::GetFileDropList() -join ',') expected=$(Join-Path $outputDirectory 'capture_1.gif') status=$(Get-ControlText $main 118)"
    }
    # Closing the unsaved result clears its temporary file and its own clipboard reference.
    Select-Region 300 200 160 120
    $staged=Start-Clip $false
    Send-Command $toolbar 117
    $saveDialog=Wait-TestWindow '#32770' $app.Id
    Send-Command $saveDialog 2
    [void](Wait-Control $toolbar 134)
    if (![RecorderClipboardTest]::Contains($staged)) { throw 'Temporary MP4 was not copied before saving' }
    [void][CaptureUiNative]::PostMessage($toolbar,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    [void](Wait-Control $toolbar 122 $false)
    if ((Test-Path -LiteralPath $staged) -or [RecorderClipboardTest]::Contains($staged)) { throw 'Closing unsaved result left its file or clipboard reference' }
    # Manual copy works with automatic copy disabled; closing preserves newer clipboard contents.
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,131),0x00F1,[IntPtr]::Zero,[IntPtr]::Zero)
    Send-Command $main 131
    Select-Region 300 200 160 120
    $staged=Start-Clip $false
    Send-Command $toolbar 117
    $saveDialog=Wait-TestWindow '#32770' $app.Id
    Send-Command $saveDialog 2
    [void](Wait-Control $toolbar 134)
    Send-Command $toolbar 134
    for ($attempt=0;$attempt -lt 40 -and ![RecorderClipboardTest]::Contains($staged);++$attempt) { Start-Sleep -Milliseconds 25 }
    if (![RecorderClipboardTest]::Contains($staged)) { throw 'Manual copy of unsaved output failed' }
    [RecorderClipboardTest]::SetSentinel()
    Send-Command $toolbar 123
    [void](Wait-Control $toolbar 122 $false)
    if ((Test-Path -LiteralPath $staged) -or ![RecorderClipboardTest]::HasSentinel()) { throw 'Discard damaged newer clipboard contents' }
    Select-Region 300 200 160 120
    $staged=Start-Clip $false
    Send-Command $toolbar 120
    $confirmation=Wait-TestWindow '#32770' $app.Id
    Send-Command $confirmation 6
    [void](Wait-Control $toolbar 117 $false)
    Start-Sleep -Milliseconds 400
    if ((Test-Path -LiteralPath $staged) -or (Find-TestWindow '#32770' $app.Id) -ne [IntPtr]::Zero) { throw 'Confirmed close did not discard recording' }
    Check-NoFrame
    # Auto-save must avoid overwriting an existing output.
    Send-Command $main 201
    [void](Wait-Control $main 114)
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,114),0x00F1,[IntPtr]1,[IntPtr]::Zero)
    Send-Command $main 114
    Select-Region 300 200 161 121
    $staged = Start-Clip $false
    Assert-Equal (Get-Region) @(300,200,161,121) 'MP4 even canvas moved the physical ROI'
    Send-Command $toolbar 117
    for ($attempt=0;$attempt -lt 150 -and !(Test-Path -LiteralPath (Join-Path $outputDirectory 'capture_1.mp4'));++$attempt) { Start-Sleep -Milliseconds 50 }
    Check-File (Join-Path $outputDirectory 'capture_1.mp4') $false
    Check-NoFrame
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,131),0x00F1,[IntPtr]1,[IntPtr]::Zero)
    Send-Command $main 131
    Select-Region 300 200 160 120
    $oldPaths = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | ForEach-Object FullName)
    Send-Command $toolbar 115
    [void](Wait-Control $toolbar 117)
    $testTemporaryPaths += @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | Where-Object { $_.FullName -notin $oldPaths } | ForEach-Object FullName)
    Start-Sleep -Milliseconds 1100
    Send-Command $toolbar 121
    [void](Wait-TestWindow 'LightCaptureRegionSelector' $app.Id)
    Send-Command $toolbar 117
    $uniquePath = Join-Path $outputDirectory 'capture_2.mp4'
    for ($attempt=0;$attempt -lt 150 -and !(Test-Path -LiteralPath $uniquePath);++$attempt) { Start-Sleep -Milliseconds 50 }
    Check-File $uniquePath $false
    Start-Sleep -Milliseconds 150
    if (![RecorderClipboardTest]::Contains($uniquePath)) { throw 'Saved recording was not copied as a clipboard file' }
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,131),0x00F1,[IntPtr]::Zero,[IntPtr]::Zero)
    Send-Command $main 131
    # Failed auto-save must retain the recording and permit discard.
    Set-ControlText $main 111 (Join-Path $outputDirectory 'missing\folder')
    Select-Region 300 200 160 120
    $oldPaths = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | ForEach-Object FullName)
    Send-Command $toolbar 115
    [void](Wait-Control $toolbar 117)
    $staged = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'LightCapture-*' -File | Where-Object { $_.FullName -notin $oldPaths } | ForEach-Object FullName)[0]
    $testTemporaryPaths += $staged
    Start-Sleep -Milliseconds 1100
    Send-Command $toolbar 117
    [void](Wait-Control $toolbar 122)
    Start-Sleep -Milliseconds 200
    if (!(Test-Path -LiteralPath $staged)) { throw 'Auto-save failure lost recording' }
    Send-Command $toolbar 123
    Start-Sleep -Milliseconds 200
    if (Test-Path -LiteralPath $staged) { throw 'Discard did not delete owned staging file' }
    Check-NoFrame
    # Bottom-edge selection should put controls above, inside the screen work area.
    $screenHeight=[CaptureUiNative]::GetSystemMetrics(1)
    Select-Region 300 ($screenHeight-130) 160 120
    $position=Get-TestRect $toolbar
    if ($position[1]+$position[3] -gt ($screenHeight-130)) { throw 'Bottom-edge toolbar was not moved above ROI' }
    Send-Command $toolbar 120
    Start-Sleep -Milliseconds 100
    Set-ControlText $main 113 '測試保存名稱'
    [void][CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,135),0x00F1,[IntPtr]::Zero,[IntPtr]::Zero)
    Send-Command $main 135
    Send-Command $main 114
    Send-Command $main 202
    if (!$app.WaitForExit(3000)) { throw 'Tray Exit did not terminate idle app' }
    $previousSettings=$env:LIGHTCAPTURE_SETTINGS_PATH
    $env:LIGHTCAPTURE_SETTINGS_PATH=Join-Path $outputDirectory 'settings.ini'
    $app=Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
    $env:LIGHTCAPTURE_SETTINGS_PATH=$previousSettings
    $main=Wait-TestWindow 'LightRegionRecorderWindow' $app.Id $false
    Start-Sleep -Milliseconds 200
    [void][CaptureUiNative]::ShowWindow($main,5)
    [void](Wait-Control $main 105)
    $toolbar=Wait-TestWindow 'LightCaptureRegionToolbar' $app.Id $false
    Assert-Equal (Get-ControlText $main 113) '測試保存名稱' 'Unicode setting persistence'
    Assert-Equal ([CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,135),0x00F0,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) 0 'Cursor preference persists after restart'
    Assert-Equal ([CaptureUiNative]::SendMessage([CaptureUiNative]::GetDlgItem($main,129),0x0402,[IntPtr]::Zero,[IntPtr]::Zero).ToInt32()) (0x0674) 'Hotkey persistence'
    Check-NoFrame
    [void][CaptureUiNative]::PostMessage($main,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    if(!$app.WaitForExit(3000)){throw 'Main X did not terminate the idle recorder'}
    Write-Output 'idle-no-frame=ok live-border-pixels=ok ready-toolbar=ok cancel-exact=ok minimize-taskbar=ok explicit-tray=ok hotkey-edit=ok global-hotkeys=ok esc-recording-safe=ok resize-paused=ok fixed-canvas=ok temp-staging=ok save-dialog=ok gif=ok mp4=ok auto-save=ok unique=ok temporary-clipboard=ok close-cleanup=ok preserve-new-clipboard=ok clipboard-file=ok save-failure=ok discard=ok edge-placement=ok unicode-settings=ok result=PASS'
}
finally {
    [RecorderClipboardTest]::Restore()
    if ($main -ne [IntPtr]::Zero -and !$app.HasExited) { Send-Command $main 202; if (!$app.WaitForExit(3000)) { Stop-Process -Id $app.Id -Force } }
    elseif (!$app.HasExited) { Stop-Process -Id $app.Id -Force }
    foreach ($path in $testTemporaryPaths) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
    $resolved = (Resolve-Path -LiteralPath $outputDirectory).Path
    if (!(Split-Path -Leaf $resolved).StartsWith('region_ui_smoke_') -or (Split-Path -Parent $resolved) -ne (Resolve-Path -LiteralPath $env:TEMP).Path) { throw 'Unexpected cleanup target' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
