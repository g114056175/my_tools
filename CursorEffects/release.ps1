param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
if(!$SkipBuild){& (Join-Path $root 'build.ps1')}
$build=Get-Content -LiteralPath (Join-Path $root 'dist/build-info.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if((Get-FileHash -LiteralPath (Join-Path $root 'dist/CursorEffects.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $build.exeSha256){throw 'Release EXE does not match build-info.'}
foreach($entry in $build.sourceSha256.PSObject.Properties){if((Get-FileHash -LiteralPath (Join-Path $root $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value){throw ('Release source differs: '+$entry.Name)}}
& (Join-Path $root 'tests/security-scan.ps1') -File (Join-Path $root 'dist/CursorEffects.exe')
New-Item -ItemType Directory -Force -Path (Join-Path $root 'release') | Out-Null
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
function Write-CursorZip([string]$path,[IO.FileInfo[]]$files,[string]$base){
    $temporary=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $prefix=[IO.Path]::GetFullPath($base).TrimEnd('\')+'\'
    try{
        $archive=[IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Create)
        try{foreach($file in $files | Sort-Object FullName){if(!$file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP input outside expected root.'};$relative=$file.FullName.Substring($prefix.Length).Replace('\','/');if($relative -match '(^|/)__pycache__/|^docs/comparison/analysis/04_verification/(performance-before-optimization|optimization-comparison)\.json$'){continue};$null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal)}}finally{$archive.Dispose()}
        Move-Item -LiteralPath $temporary -Destination $path -Force
    }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
}
$dist=Join-Path $root 'dist'
$binaryFiles=@('CursorEffects.exe','README.md','Preview.md','CHANGELOG.md','build-info.json') | ForEach-Object {Get-Item -LiteralPath (Join-Path $dist $_)}
$binaryFiles+=Get-ChildItem -LiteralPath (Join-Path $dist 'licenses') -File
$binaryFiles+=Get-ChildItem -LiteralPath (Join-Path $dist 'docs') -File -Recurse
Write-CursorZip (Join-Path $root 'release/CursorEffects-win-x64.zip') $binaryFiles $dist
$sourceFiles=@('.gitignore','.gitattributes','README.md','Preview.md','Preview.cmd','CHANGELOG.md','toolchain.json','build.ps1','release.ps1','Start.cmd') | ForEach-Object {Get-Item -LiteralPath (Join-Path $root $_)}
foreach($directory in @('src','assets','docs','tests','tools','licenses','.github')){if(Test-Path -LiteralPath (Join-Path $root $directory)){$sourceFiles+=Get-ChildItem -LiteralPath (Join-Path $root $directory) -File -Recurse}}
Write-CursorZip (Join-Path $root 'release/CursorEffects-source.zip') $sourceFiles $root
Copy-Item -LiteralPath (Join-Path $dist 'CursorEffects.exe') -Destination (Join-Path $root 'release/CursorEffects.exe') -Force
$releaseArtifacts=@('CursorEffects.exe','CursorEffects-win-x64.zip','CursorEffects-source.zip') | ForEach-Object {Get-Item -LiteralPath (Join-Path $root ('release/'+$_))}
$releaseHashes=$releaseArtifacts | ForEach-Object {((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$_.Name}
$releaseHashes | Set-Content -LiteralPath (Join-Path $root 'release/SHA256SUMS.txt') -Encoding ASCII
Get-Item -LiteralPath (Join-Path $root 'release/CursorEffects-win-x64.zip'),(Join-Path $root 'release/CursorEffects-source.zip') | Select-Object Name,Length
