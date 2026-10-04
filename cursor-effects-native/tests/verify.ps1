$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
& (Join-Path $root 'build.ps1') -Test
$exe=Join-Path $root '.build/test/BlueArchiveCursor.Native.exe'
$process=Start-Process -FilePath $exe -ArgumentList '--self-test','--controls-test' -WindowStyle Hidden -PassThru
if(!$process.WaitForExit(30000)){Stop-Process -Id $process.Id;throw 'Verification timeout.'}
$profile=Join-Path (Split-Path $exe) ('test-profile-'+$process.Id)
$report=Get-Content -LiteralPath (Join-Path $profile 'test.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($file in Get-ChildItem -LiteralPath $profile -File){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $root 'test-results') -Force}
$report | ConvertTo-Json -Depth 6
if(!$report.passed){throw 'Native verification failed.'}
