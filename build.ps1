param(
  [ValidateSet("portable", "portable_compact", "small", "smallest")]
  [string]$Profile = "portable",
  [string]$Output = "llm_overlay.exe"
)

$ErrorActionPreference = "Stop"

$source = "main.cpp"
$exe = $Output
$libs = @(
  "winhttp.lib", "user32.lib", "gdi32.lib",
  "shell32.lib", "ole32.lib", "gdiplus.lib"
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
  $obj = [IO.Path]::ChangeExtension($source, ".obj")
  if (Test-Path $obj) {
    Remove-Item -LiteralPath $obj -Force
  }
}

function Compile-Msvc($clPath) {
  $flags = Get-MsvcFlags $Profile
  & $clPath @($flags.Cl) $source "/Fe:$exe" /link @($flags.Link) @($libs)
  if ($LASTEXITCODE -eq 0) { Remove-IntermediateFiles; Show-BinarySize }
}

function Find-Tool($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Path }
  return $null
}

$cl = Find-Tool "cl.exe"
if ($cl) {
  Compile-Msvc $cl
  exit 0
}

$vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
  $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
  if ($installPath) {
    $vcvars = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path $vcvars) {
      $flags = Get-MsvcFlags $Profile
      $clPart = ($flags.Cl + @($source, "/Fe:$exe", "/link") + $flags.Link + $libs) -join " "
    $cmd = "`"$vcvars`" && cl $clPart"
    & cmd.exe /c $cmd
      if ($LASTEXITCODE -eq 0) { Remove-IntermediateFiles; Show-BinarySize; exit 0 }
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
    $flags = Get-MsvcFlags $Profile
    $clPart = ($flags.Cl + @($source, "/Fe:$exe", "/link") + $flags.Link + $libs) -join " "
    $cmd = "`"$vcvars`" && cl $clPart"
    & cmd.exe /c $cmd
    if ($LASTEXITCODE -eq 0) { Remove-IntermediateFiles; Show-BinarySize; exit 0 }
  }
}

$gxx = Find-Tool "g++.exe"
if ($gxx) {
  & $gxx -Os -s -DWINVER=0x0601 -D_WIN32_WINNT=0x0601 $source -o $exe -lwinhttp -lgdi32 -luser32 -ladvapi32 -lcomdlg32 -lshell32 -lole32 -lgdiplus
  if ($LASTEXITCODE -eq 0) { Show-BinarySize }
  exit 0
}

Write-Error "No C compiler found. Install MSVC Build Tools or MinGW."
