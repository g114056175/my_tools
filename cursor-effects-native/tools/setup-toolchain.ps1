$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot
$manifest=Get-Content -LiteralPath (Join-Path $root 'toolchain.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cache=Join-Path $root '.tools'
$archive=Join-Path $cache $manifest.archive
$compiler=Join-Path $cache ($manifest.directory+'/bin/clang++.exe')
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if(!(Test-Path -LiteralPath $archive)){
    [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $manifest.url -OutFile $archive -UseBasicParsing
}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256){throw 'LLVM-MinGW archive SHA256 mismatch. The archive was not extracted.'}
if(!(Test-Path -LiteralPath $compiler)){Expand-Archive -LiteralPath $archive -DestinationPath $cache -Force}
if(!(Test-Path -LiteralPath $compiler)){throw 'LLVM-MinGW compiler not found after extraction.'}
Write-Host "Ready: $compiler"
