param([switch]$LocateExe)
$ErrorActionPreference='Stop'
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($LocateExe){
    $artifact=@('dist\BlueArchiveCursor.exe','.build\current\BlueArchiveCursor.exe') | ForEach-Object {Join-Path $project $_} | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | ForEach-Object {Get-Item -LiteralPath $_} | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1 -ExpandProperty FullName
    if(!(Test-Path -LiteralPath $artifact -PathType Leaf)){throw "Missing file: $artifact"}
    Start-Process -FilePath (Join-Path $env:WINDIR 'explorer.exe') -ArgumentList ('/select,"'+$artifact+'"')
    exit
}
$command=Get-Command code -ErrorAction SilentlyContinue
$editor=if($command){$command.Source}else{Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'}
if(!(Test-Path -LiteralPath $editor)){throw 'VS Code command was not found. Install its code command or add it to PATH.'}
$comparison=Join-Path $project 'docs\comparison\README.md'
$files=@(if(Test-Path -LiteralPath $comparison -PathType Leaf){$comparison}else{Join-Path $project 'Preview.md'})
foreach($file in $files){if(!(Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing preview: $file"}}
& $editor --reuse-window @files
if($LASTEXITCODE -ne 0){throw 'VS Code rejected the open request.'}
