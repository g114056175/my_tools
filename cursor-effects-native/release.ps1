$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($PSScriptRoot)
& (Join-Path $root 'build.ps1')
New-Item -ItemType Directory -Force -Path (Join-Path $root 'release') | Out-Null
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
function Write-CursorZip([string]$path,[IO.FileInfo[]]$files,[string]$base){
    $temporary=$path+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
    $prefix=[IO.Path]::GetFullPath($base).TrimEnd('\')+'\'
    try{
        $archive=[IO.Compression.ZipFile]::Open($temporary,[IO.Compression.ZipArchiveMode]::Create)
        try{foreach($file in $files | Sort-Object FullName){if(!$file.FullName.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP input outside expected root.'};$relative=$file.FullName.Substring($prefix.Length).Replace('\','/');$null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal)}}finally{$archive.Dispose()}
        Move-Item -LiteralPath $temporary -Destination $path -Force
    }finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}}
}
$dist=Join-Path $root 'dist'
$binaryFiles=@('BlueArchiveCursor.exe','README.md','THIRD_PARTY_NOTICES.md') | ForEach-Object {Get-Item -LiteralPath (Join-Path $dist $_)}
$binaryFiles+=Get-ChildItem -LiteralPath (Join-Path $dist 'licenses') -File
$binaryFiles+=Get-ChildItem -LiteralPath (Join-Path $dist 'docs') -File
Write-CursorZip (Join-Path $root 'release/BlueArchiveCursor-win-x64.zip') $binaryFiles $dist
$sourceFiles=@('.gitignore','.gitattributes','README.md','THIRD_PARTY_NOTICES.md','toolchain.json','build.ps1','release.ps1','Start.cmd') | ForEach-Object {Get-Item -LiteralPath (Join-Path $root $_)}
foreach($directory in @('src','assets','docs','tests','tools','licenses','.github')){if(Test-Path -LiteralPath (Join-Path $root $directory)){$sourceFiles+=Get-ChildItem -LiteralPath (Join-Path $root $directory) -File -Recurse}}
Write-CursorZip (Join-Path $root 'release/cursor-effects-native-source.zip') $sourceFiles $root
Get-Item -LiteralPath (Join-Path $root 'release/BlueArchiveCursor-win-x64.zip'),(Join-Path $root 'release/cursor-effects-native-source.zip') | Select-Object Name,Length
