param([string]$File)
$ErrorActionPreference = 'Stop'
if (!$File) { $File = Join-Path $PSScriptRoot '../dist/BlueArchiveCursor.exe' }
$taskFile = [IO.Path]::GetFullPath($File)
if (!(Test-Path -LiteralPath $taskFile -PathType Leaf)) { throw 'Security scan blocked: release file is missing or quarantined.' }
$taskStatus = Get-MpComputerStatus -ErrorAction Stop
if (!$taskStatus.AntivirusEnabled -or !$taskStatus.RealTimeProtectionEnabled) { throw 'Security scan blocked: Microsoft Defender Antivirus must be enabled.' }
$taskPlatform = Join-Path $env:ProgramData 'Microsoft/Windows Defender/Platform'
$taskScanner = Get-ChildItem -LiteralPath $taskPlatform -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
if (!$taskScanner) { $taskScanner = Join-Path $env:ProgramFiles 'Windows Defender/MpCmdRun.exe' }
if (!(Test-Path -LiteralPath $taskScanner -PathType Leaf)) { throw 'Security scan blocked: Defender scanner is unavailable.' }
Write-Host ('Defender definitions: ' + $taskStatus.AntivirusSignatureVersion)
& $taskScanner -Scan -ScanType 3 -File $taskFile -DisableRemediation
$taskScanExit = $LASTEXITCODE
if ($taskScanExit -ne 0) { throw "Security scan blocked: Defender returned $taskScanExit (detection or scan failure)." }
$taskHash = (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256 -ErrorAction Stop).Hash
Write-Host ('Defender scan passed: ' + $taskHash)
