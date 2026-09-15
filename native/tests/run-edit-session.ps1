$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binary = Join-Path $PSScriptRoot 'EditSessionTest.exe'
$flags = @('-std=c++20', '-DUNICODE', '-D_UNICODE', '-D_WIN32_WINNT=0x0A00', '-static', '-O2')
& clang++ @flags (Join-Path $PSScriptRoot 'EditSessionTest.cpp') -o $binary
if ($LASTEXITCODE -ne 0) { throw 'EditSession test compile failed' }
& $binary
if ($LASTEXITCODE -ne 0) { throw 'EditSession tests failed' }
