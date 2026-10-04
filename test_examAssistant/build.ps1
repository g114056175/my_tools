param(
  [ValidateSet("portable", "portable_compact", "small", "smallest")]
  [string]$Profile = "portable",
  [string]$Output = "llm_overlay.exe"
)

$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$source = Join-Path $projectRoot "main.cpp"
$exe = if ([IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $projectRoot $Output }
$exeDirectory = Split-Path -Parent $exe
if ($exeDirectory) { New-Item -ItemType Directory -Path $exeDirectory -Force | Out-Null }
$libs = @(
  "winhttp.lib", "user32.lib", "gdi32.lib",
  "shell32.lib", "ole32.lib", "gdiplus.lib", "uuid.lib"
)

function Get-MsvcFlags($profile) {
  $common = @(
    "/nologo", "/O1", "/Os", "/GL", "/Gy", "/Gw", "/GF",
    "/DNOMINMAX", "/DUNICODE", "/D_UNICODE", "/DWINVER=0x0601", "/D_WIN32_WINNT=0x0601"
  )
  $linkCommon = @("/LTCG", "/OPT:REF", "/OPT:ICF")

  switch ($profile) {
    "portable" {
      return @{
        Cl = $common + @("/MT")
        Link = $linkCommon
      }
    }
    "portable_compact" {
      return @{
        Cl = $common + @("/MT")
        Link = $linkCommon + @("/DYNAMICBASE:NO")
      }
    }
    "small" {
      return @{
        Cl = $common + @("/MD")
        Link = $linkCommon
      }
    }
    "smallest" {
      return @{
        Cl = $common + @("/MD", "/GS-", "/guard:cf-")
        Link = $linkCommon + @("/DYNAMICBASE:NO")
      }
    }
  }
}

function Show-BinarySize {
  if (Test-Path $exe) {
    $f = Get-Item $exe
    $kb = [Math]::Round($f.Length / 1KB, 2)
    Write-Host "Built $($f.Name): $($f.Length) bytes ($kb KB) [profile=$Profile]"
  }
}

function Remove-IntermediateFiles {
  $obj = Join-Path $projectRoot ([IO.Path]::GetFileNameWithoutExtension($source) + ".obj")
  if (Test-Path $obj) {
    Remove-Item -LiteralPath $obj -Force
  }
}

function Compile-Msvc($clPath) {
  $flags = Get-MsvcFlags $Profile
  & $clPath @($flags.Cl) $source "/Fe:$exe" "/Fo:$projectRoot/main.obj" /link @($flags.Link) @($libs) | Out-Host
  if ($LASTEXITCODE -ne 0) { return $false }
  Remove-IntermediateFiles
  Show-BinarySize
  return $true
}

function Quote-CmdArg([string]$value) {
  return '"' + $value.Replace('"', '\"') + '"'
}

function Compile-MsvcViaVcvars([string]$vcvars) {
  $flags = Get-MsvcFlags $Profile
  $parts = @($flags.Cl + @((Quote-CmdArg $source), ("/Fe:" + (Quote-CmdArg $exe)), ("/Fo:" + (Quote-CmdArg (Join-Path $projectRoot 'main.obj'))), "/link") + $flags.Link + $libs)
  $cmd = (Quote-CmdArg $vcvars) + " && cl " + ($parts -join " ")
  & cmd.exe /d /c $cmd | Out-Host
  if ($LASTEXITCODE -ne 0) { return $false }
  Remove-IntermediateFiles
  Show-BinarySize
  return $true
}

function Compile-Gnu([string]$compiler) {
  & $compiler -Os -s -DWINVER=0x0601 -D_WIN32_WINNT=0x0601 $source -o $exe `
    -lwinhttp -lgdi32 -luser32 -ladvapi32 -lcomdlg32 -lshell32 -lole32 -lgdiplus -luuid | Out-Host
  if ($LASTEXITCODE -ne 0) { return $false }
  Show-BinarySize
  return $true
}

function Compile-Clang([string]$compiler) {
  if ($Profile -ne "portable") {
    Write-Warning "LLVM-MinGW fallback uses portable static runtime flags; profile '$Profile' is mapped to portable semantics."
  }
  & $compiler -Os -s -static -DWINVER=0x0601 -D_WIN32_WINNT=0x0601 $source -o $exe `
    -lwinhttp -lgdi32 -luser32 -ladvapi32 -lcomdlg32 -lshell32 -lole32 -lgdiplus -luuid | Out-Host
  if ($LASTEXITCODE -ne 0) { return $false }
  Show-BinarySize
  return $true
}

function Find-Tool($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return $null
}

$cl = Find-Tool "cl.exe"
if ($cl) {
  if (Compile-Msvc $cl) { exit 0 }
  Write-Warning "MSVC compilation failed; trying other available toolchains."
}

$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ($installPath) {
    $vcvars = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path $vcvars) {
      if (Compile-MsvcViaVcvars $vcvars) { exit 0 }
      Write-Warning "MSVC vcvars compilation failed; trying other available toolchains."
    }
  }
}

$fallbacks = @(
  "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files\Microsoft Visual Studio\17\Community\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files\Microsoft Visual Studio\17\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files (x86)\Microsoft Visual Studio\17\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
foreach ($vcvars in $fallbacks) {
  if (Test-Path $vcvars) {
    if (Compile-MsvcViaVcvars $vcvars) { exit 0 }
    Write-Warning "MSVC fallback compilation failed for $vcvars; trying other available toolchains."
  }
}

$gxx = Find-Tool "g++.exe"
if ($gxx) {
  if (Compile-Gnu $gxx) { exit 0 }
  Write-Warning "g++ compilation failed; trying LLVM-MinGW clang++."
}

$clang = Find-Tool "clang++.exe"
if ($clang) {
  if (Compile-Clang $clang) { exit 0 }
  Write-Error "LLVM-MinGW clang++ compilation failed."
}

Write-Error "No working C compiler found. Install MSVC Build Tools, MinGW, or LLVM-MinGW."
