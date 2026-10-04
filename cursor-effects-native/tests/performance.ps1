$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
& (Join-Path $root 'build.ps1') -Test
$null=Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
$exe=Join-Path $root '.build/test/BlueArchiveCursor.Native.exe'
& (Join-Path $PSScriptRoot 'security-scan.ps1') -File $exe
$process=Start-Process -FilePath $exe -ArgumentList '--performance-test' -WindowStyle Hidden -PassThru
$profile=Join-Path (Split-Path $exe) ('test-profile-'+$process.Id)
$phasePath=Join-Path $profile 'performance-phase.json'
$watch=[Diagnostics.Stopwatch]::StartNew();$samples=[Collections.Generic.List[object]]::new()
while(!$process.HasExited -and $watch.ElapsedMilliseconds -lt 55000){
    Start-Sleep -Milliseconds 750
    if(!(Test-Path -LiteralPath $phasePath)){continue}
    try{
        $phase=Get-Content -LiteralPath $phasePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if($phase.phase -eq 'transition'){continue}
        $filter=($phase.processIds | ForEach-Object {"Name LIKE 'pid_$($_)_%'"}) -join ' OR '
        $engines=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Filter $filter)
        $after=Get-Content -LiteralPath $phasePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if($after.phase -eq $phase.phase){$samples.Add([pscustomobject]@{phase=$phase.phase;engines=@($engines | Select-Object Name,UtilizationPercentage)})}
    }catch{}
    $process.Refresh()
}
if(!$process.HasExited){Stop-Process -Id $process.Id;throw 'Performance timeout.'}
$report=Get-Content -LiteralPath (Join-Path $profile 'performance.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$report | Add-Member -NotePropertyName gpuSamples -NotePropertyValue $samples
$report | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $root 'test-results/performance.json') -Encoding UTF8
$report.phases | Select-Object phase,cpuPercentAllLogicalProcessors,privateMiB,workingSetMiB,@{n='frames';e={$_.frames.frames}},@{n='p95Ms';e={$_.frames.frameP95Ms}} | ConvertTo-Json
if(!$report.passed){throw 'Performance test failed.'}
