param([string]$Dotnet = 'dotnet', [switch]$Audio, [switch]$Capture)
$ErrorActionPreference = 'Stop'
$compiler = Get-Command $Dotnet -ErrorAction Stop
$testNames = @('WaveSmoke', 'WindowsAudioCodecSmoke')
if ($Audio) { $testNames += @('PcmPlayerSmoke', 'UiLayoutTest') }
if ($Capture) { $testNames += 'CaptureSmoke' }
Push-Location $PSScriptRoot
try {
    foreach ($testName in $testNames) {
        & $compiler.Source run --project (Join-Path $PSScriptRoot "tests/$testName/$testName.csproj") -c Release
        if ($LASTEXITCODE -ne 0) { throw "$testName failed: $LASTEXITCODE" }
    }
} finally { Pop-Location }
Write-Host 'All selected smoke tests passed.'
