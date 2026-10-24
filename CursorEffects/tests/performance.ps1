param([ValidateSet(8,10,50)][int]$PollMilliseconds=50,[ValidateRange(1000,300000)][int]$PhaseMilliseconds=6000,[switch]$IdleOnly,[switch]$ActiveOnly)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
& (Join-Path $root 'build.ps1') -Test
$null=Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
$exe=Join-Path $root '.build/test/CursorEffects.Test.exe'
& (Join-Path $PSScriptRoot 'security-scan.ps1') -File $exe
$arguments=@('--performance-test',"--poll-ms=$PollMilliseconds","--phase-ms=$PhaseMilliseconds");if($IdleOnly){$arguments+='--idle-only'};if($ActiveOnly){$arguments+='--active-only'}
$process=Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
$profile=Join-Path (Split-Path $exe) ('test-profile-'+$process.Id)
$phasePath=Join-Path $profile 'performance-phase.json'
$watch=[Diagnostics.Stopwatch]::StartNew();$samples=[Collections.Generic.List[object]]::new();$phaseCount=if($IdleOnly){1}elseif($ActiveOnly){2}else{6};$timeoutMs=$PhaseMilliseconds*$phaseCount+45000
while(!$process.HasExited -and $watch.ElapsedMilliseconds -lt $timeoutMs){
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
$report | Add-Member -NotePropertyName build -NotePropertyValue (Get-Content -LiteralPath (Join-Path (Split-Path $exe) 'build-info.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
$report | Add-Member -NotePropertyName gpuSamples -NotePropertyValue $samples
$report | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $root 'test-results/performance.json') -Encoding UTF8
$report.phases | Select-Object phase,cpuPercentAllLogicalProcessors,privateMiB,workingSetMiB,@{n='frames';e={$_.frames.frames}},@{n='p95Ms';e={$_.frames.frameP95Ms}} | ConvertTo-Json
if(!$report.passed){throw 'Performance test failed.'}
