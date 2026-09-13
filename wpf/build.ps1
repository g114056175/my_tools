param([switch]$Portable, [string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'src/VoiceCaptureLite/VoiceCaptureLite.csproj'
$flavor = if ($Portable) { 'portable' } else { 'framework-dependent' }
$output = Join-Path $PSScriptRoot "out/$flavor"
$compiler = Get-Command $Dotnet -ErrorAction Stop
$selfContained = $Portable.IsPresent.ToString().ToLowerInvariant()
$publishArgs = @('publish', $project, '-c', 'Release', '-r', 'win-x64',
    '--self-contained', $selfContained, '-p:PublishSingleFile=true',
    "-p:EnableCompressionInSingleFile=$selfContained", '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:DebugType=None', '-p:DebugSymbols=false', '-o', $output)
& $compiler.Source @publishArgs
if ($LASTEXITCODE -ne 0) { throw "Publish failed: $LASTEXITCODE" }
Get-Item -LiteralPath (Join-Path $output 'VoiceCaptureLite.exe') | Select-Object FullName, Length
