$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
& (Join-Path $root 'build.ps1') -Test
$exe=Join-Path $root '.build/test/CursorEffects.Test.exe'
& (Join-Path $PSScriptRoot 'security-scan.ps1') -File $exe
$process=Start-Process -FilePath $exe -ArgumentList '--self-test','--controls-test' -WindowStyle Hidden -PassThru
if(!$process.WaitForExit(30000)){Stop-Process -Id $process.Id;throw 'Verification timeout.'}
$profile=Join-Path (Split-Path $exe) ('test-profile-'+$process.Id)
$report=Get-Content -LiteralPath (Join-Path $profile 'test.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($file in Get-ChildItem -LiteralPath $profile -File){Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $root 'test-results') -Force}
$report | ConvertTo-Json -Depth 6
if(!$report.passed){throw 'Native verification failed.'}
$capture=Start-Process -FilePath $exe -ArgumentList '--click-wave-test' -WindowStyle Hidden -PassThru
if(!$capture.WaitForExit(30000)){Stop-Process -Id $capture.Id;throw 'Click center verification timeout.'}
$capturePath=Join-Path (Split-Path $exe) 'click-wave-test/result.json'
$captureReport=Get-Content -LiteralPath $capturePath -Raw -Encoding UTF8 | ConvertFrom-Json
Copy-Item -LiteralPath $capturePath -Destination (Join-Path $root 'test-results/click-wave.json') -Force
if($capture.ExitCode -ne 0 -or !$captureReport.passed){throw ('Click center verification failed: '+$captureReport.error)}
$captureReport | Select-Object passed,hardware,checks | ConvertTo-Json -Depth 4
