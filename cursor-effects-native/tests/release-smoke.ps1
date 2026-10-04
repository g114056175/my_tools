$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$exe=[IO.Path]::GetFullPath((Join-Path $root 'dist/BlueArchiveCursor.exe'))
$testPrefix=[IO.Path]::GetFullPath((Join-Path $root '.build/single-exe-smoke'))+[IO.Path]::DirectorySeparatorChar
if(@(Get-CimInstance Win32_Process -Filter "Name='BlueArchiveCursor.exe'" | Where-Object {$_.ExecutablePath -and ![IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($testPrefix)}).Count){throw 'A native cursor release is already running; close it manually before this isolated smoke test.'}
$singleRoot=Join-Path $root ('.build/single-exe-smoke/'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $singleRoot | Out-Null
Copy-Item -LiteralPath $exe -Destination $singleRoot
$exe=Join-Path $singleRoot 'BlueArchiveCursor.exe'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CursorSmoke {
 public delegate bool EnumProc(IntPtr hwnd,IntPtr data);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback,IntPtr data);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint id);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd,System.Text.StringBuilder text,int length);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd,int message,IntPtr w,IntPtr l);
 public static IntPtr FindPanel(uint target){IntPtr result=IntPtr.Zero;EnumProc callback=(hwnd,data)=>{uint owner;GetWindowThreadProcessId(hwnd,out owner);if(owner==target){var text=new System.Text.StringBuilder(128);GetWindowText(hwnd,text,128);if(text.ToString()=="\u6ed1\u9f20\u5149\u8de1"){result=hwnd;return false;}}return true;};EnumWindows(callback,IntPtr.Zero);return result;}
}
'@
function Find-Panel($processId) {return [CursorSmoke]::FindPanel($processId)}
$testPrefix=[IO.Path]::GetFullPath((Join-Path $root '.build/single-exe-smoke'))+[IO.Path]::DirectorySeparatorChar
foreach($owned in @(Get-CimInstance Win32_Process -Filter "Name='BlueArchiveCursor.exe'" | Where-Object {$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($testPrefix)})){
 $previous=Get-Process -Id $owned.ProcessId;$previousPanel=Find-Panel $owned.ProcessId
 if($previousPanel -eq [IntPtr]::Zero){throw 'Previous owned smoke-test panel missing.'}
 $null=[CursorSmoke]::PostMessage($previousPanel,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
 if(!$previous.WaitForExit(4000)){throw 'Previous owned smoke test could not close.'}
}
$process=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
try {
 $panel=[IntPtr]::Zero
 for($i=0;$i -lt 50 -and $panel -eq [IntPtr]::Zero;$i++){Start-Sleep -Milliseconds 100;$panel=Find-Panel $process.Id;if($process.HasExited){throw 'Release exited during startup.'}}
 if($panel -eq [IntPtr]::Zero){throw 'Release panel missing.'}
 for($i=0;$i -lt 50;$i++){ $process.Refresh();$modules=@($process.Modules | ForEach-Object ModuleName);if($modules -contains 'CursorRenderer.dll'){break};Start-Sleep -Milliseconds 100 }
 foreach($name in 'CursorRenderer.dll','d2d1.dll','dcomp.dll','d3d11.dll'){if($modules -notcontains $name){throw "Missing native graphics module $name"}}
 if(@($modules | Where-Object {$_ -match 'WebView|Unity'}).Count){throw 'Unexpected browser or engine module.'}
 $null=[CursorSmoke]::PostMessage($panel,0x112,[IntPtr]0xf020,[IntPtr]::Zero)
 Start-Sleep -Milliseconds 150
 if(![CursorSmoke]::IsWindowVisible($panel) -or ![CursorSmoke]::IsIconic($panel) -or $process.HasExited){throw 'Minimize did not preserve a normal taskbar window.'}
 $second=Start-Process -FilePath $exe -WindowStyle Hidden -PassThru
 if(!$second.WaitForExit(4000)){Stop-Process -Id $second.Id;throw 'Second instance failed to exit.'}
 Start-Sleep -Milliseconds 150
 if(![CursorSmoke]::IsWindowVisible($panel) -or [CursorSmoke]::IsIconic($panel)){throw 'Second launch did not restore original panel.'}
 $null=[CursorSmoke]::PostMessage($panel,0x10,[IntPtr]::Zero,[IntPtr]::Zero)
 if(!$process.WaitForExit(4000)){throw 'X did not exit release.'}
 if($process.ExitCode -ne 0){throw 'Release exit code failed.'}
 if(@(Get-ChildItem -LiteralPath $singleRoot -File).Count -ne 1){throw 'Single-exe directory gained dependencies.'}
 [pscustomobject]@{passed=$true;filesBesideExe=1;checks=@('EXE runs alone in a clean folder','embedded native DLL loads from cache, no browser/Unity','normal taskbar minimize','second instance restores panel and exits','X exits release')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'test-results/release-smoke.json') -Encoding UTF8
 Get-Content -LiteralPath (Join-Path $root 'test-results/release-smoke.json') -Raw
}finally{if(!$process.HasExited){$panel=Find-Panel $process.Id;if($panel -ne [IntPtr]::Zero){$null=[CursorSmoke]::PostMessage($panel,0x10,[IntPtr]::Zero,[IntPtr]::Zero)};if(!$process.WaitForExit(2000)){Stop-Process -Id $process.Id}}}
