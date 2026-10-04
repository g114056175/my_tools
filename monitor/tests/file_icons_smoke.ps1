param([Parameter(Mandatory=$true)][string]$BundleRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FileIconNative {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    public static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll")]
    public static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", EntryPoint="FindResourceW")]
    public static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll")]
    public static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")]
    public static extern IntPtr LockResource(IntPtr resource);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern uint PrivateExtractIcons(string file, int index, int cx, int cy,
        out IntPtr icon, out uint iconId, uint count, uint flags);
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr icon);
}
'@
$entries = @('region_recorder/region_recorder.exe', 'monitor/WGC/window_monitor.exe', 'monitor/DWM/dwm_window_monitor.exe')
foreach ($entry in $entries) {
    $file = (Resolve-Path -LiteralPath (Join-Path $BundleRoot $entry)).Path
    # Inspect file resources without starting the executable. Runtime WM_SETICON is insufficient.
    $module = [FileIconNative]::LoadLibraryEx($file, [IntPtr]::Zero, 2)
    if ($module -eq [IntPtr]::Zero) { throw "Cannot load resources: $entry" }
    try {
        $resource = [FileIconNative]::FindResource($module, [IntPtr]101, [IntPtr]14)
        if ($resource -eq [IntPtr]::Zero) { throw "Missing embedded icon group: $entry" }
        $data = [FileIconNative]::LockResource([FileIconNative]::LoadResource($module, $resource))
        $count = [Runtime.InteropServices.Marshal]::ReadInt16($data, 4)
        if ($count -ne 9) { throw "Expected nine icon sizes: $entry" }
        $sizes = for ($i=0; $i -lt $count; $i++) {
            $size = [Runtime.InteropServices.Marshal]::ReadByte($data, 6 + 14*$i)
            if ($size -eq 0) { 256 } else { [int]$size }
        }
        if (($sizes -join ',') -ne '16,20,24,32,40,48,64,128,256') { throw "Incorrect icon sizes: $entry" }
    } finally { [void][FileIconNative]::FreeLibrary($module) }
    foreach ($size in @(16,32,48,256)) {
        $handle = [IntPtr]::Zero
        $id = [uint32]0
        $result = [FileIconNative]::PrivateExtractIcons($file, 0, $size, $size, [ref]$handle, [ref]$id, 1, 0)
        if ($result -ne 1 -or $handle -eq [IntPtr]::Zero) { throw "Shell icon extraction failed: $entry / $size" }
        try {
            $icon = [Drawing.Icon]::FromHandle($handle)
            $image = $icon.ToBitmap()
            try {
                if ($image.Width -ne $size -or $image.Height -ne $size) { throw 'Incorrect extracted dimensions' }
                $colored = 0
                for ($y=0; $y -lt $size; $y++) {
                    for ($x=0; $x -lt $size; $x++) {
                        $pixel=$image.GetPixel($x,$y)
                        if ($pixel.A -gt 128 -and ([Math]::Max($pixel.R,[Math]::Max($pixel.G,$pixel.B)) - [Math]::Min($pixel.R,[Math]::Min($pixel.G,$pixel.B))) -gt 50) { $colored++ }
                    }
                }
                if ($colored -lt $size) { throw "Empty or generic extracted icon: $entry / $size" }
                if ($image.GetPixel(0,0).A -ne 0) { throw "Icon transparency missing: $entry" }
            } finally { $image.Dispose(); $icon.Dispose() }
        } finally { [void][FileIconNative]::DestroyIcon($handle) }
    }
    Write-Output "$entry embedded-icon=PASS nine-sizes=PASS shell-extraction=PASS transparency=PASS"
}
