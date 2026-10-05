param([switch]$Test,[string]$Compiler)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
$manifest=Get-Content -LiteralPath (Join-Path $root 'toolchain.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if(!$Compiler){
    $local=Join-Path $root ('.tools/'+$manifest.directory+'/bin/clang++.exe')
    $Compiler=if(Test-Path -LiteralPath $local){$local}else{'clang++.exe'}
}
$cpp=(Get-Command $Compiler -ErrorAction Stop).Source
$cppVersion=(& $cpp --version) -join "`n"
if($LASTEXITCODE -ne 0 -or $cppVersion -notmatch ('clang version '+[regex]::Escape($manifest.clangVersion)) -or $cppVersion -notmatch 'Target: x86_64-w64-windows-gnu'){throw 'Use the pinned LLVM-MinGW x64 UCRT toolchain. Run tools/setup-toolchain.ps1 first.'}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if(!(Test-Path -LiteralPath $compiler)){throw 'System .NET Framework C# compiler is missing.'}
$out=Join-Path $root $(if($Test){'.build/test'}else{'dist'})
$exeName=if($Test){'BlueArchiveCursor.Native.exe'}else{'BlueArchiveCursor.exe'}
New-Item -ItemType Directory -Force -Path $out,(Join-Path $root '.build/native'),(Join-Path $root 'test-results') | Out-Null
$module=Join-Path $root '.build/native/CursorRenderer.dll'
& $cpp '-std=c++17' '-O2' '-flto' '-shared' '-static' '-nostdlib++' '-fno-exceptions' '-fno-rtti' '-ffunction-sections' '-fdata-sections' '-Wl,--gc-sections,--no-insert-timestamp' '-s' (Join-Path $root 'src/Renderer.cpp') '-o' $module '-ld2d1' '-ld3d11' '-ldxgi' '-ldcomp' '-lole32' '-luuid'
if($LASTEXITCODE -ne 0){throw 'Native renderer build failed.'}
$compressed=Join-Path $root '.build/native/Renderer.gz'
$target=[IO.File]::Create($compressed)
try{$gzip=[IO.Compression.GZipStream]::new($target,[IO.Compression.CompressionLevel]::Optimal,$true);try{$input=[IO.File]::OpenRead($module);try{$input.CopyTo($gzip)}finally{$input.Dispose()}}finally{$gzip.Dispose()}}finally{$target.Dispose()}
$arguments=@('/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001','/utf8output',"/out:$out/$exeName","/win32icon:$root/assets/cursor.ico",'/r:System.Windows.Forms.dll','/r:System.Drawing.dll','/r:System.Web.Extensions.dll')
$arguments+="/resource:$compressed,Cursor.Renderer.gz"
$arguments+=@('AssemblyInfo.cs','Native.cs','Controls.cs','Effects.cs','Renderer.cs','EmbeddedRuntime.cs','FrameClock.cs','Program.cs') | ForEach-Object {Join-Path $root "src/$_"}
if($Test){$arguments+='/define:SELF_TEST';$arguments+=Join-Path $root 'tests/NativeTests.cs';$arguments+=Join-Path $root 'tests/Performance.cs'}
& $compiler @arguments
if($LASTEXITCODE -ne 0){throw 'Host build failed. Close an existing instance if its EXE is locked.'}
if(!$Test){
    Copy-Item -LiteralPath (Join-Path $root 'README.md'),(Join-Path $root 'THIRD_PARTY_NOTICES.md') -Destination $out -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $out 'licenses') | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $root 'licenses') -File | Copy-Item -Destination (Join-Path $out 'licenses') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $out 'docs') | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $root 'docs') -File | Copy-Item -Destination (Join-Path $out 'docs') -Force
}
$hashes=[ordered]@{}
foreach($directory in @('src','assets')){foreach($file in Get-ChildItem -LiteralPath (Join-Path $root $directory) -File){$hashes[$directory+'/'+$file.Name]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}}
[ordered]@{toolchain=$manifest.version;clang=$cppVersion;csharp=(Get-Item -LiteralPath $compiler).VersionInfo.ProductVersion;nativeFlags='-O2 -flto -nostdlib++';sourceSha256=$hashes;exeBytes=(Get-Item -LiteralPath (Join-Path $out $exeName)).Length;exeSha256=(Get-FileHash -LiteralPath (Join-Path $out $exeName) -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root '.build/build-info.json') -Encoding UTF8
Write-Host "Built $out/$exeName"
