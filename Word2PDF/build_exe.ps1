$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

$Python = "python"
if (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = "py -3"
} elseif (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python was not found. Please install Python 3.10+."
}

if (-not (Test-Path ".venv")) {
    Invoke-Expression "$Python -m venv .venv"
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed." }

& ".\.venv\Scripts\python.exe" -m PyInstaller `
    --noconfirm `
    --clean `
    --windowed `
    --onefile `
    --collect-data tkinterdnd2 `
    --name Word2PDF-Batch `
    word2pdf_gui.py
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed." }

Write-Host ""
Write-Host "Done: $ProjectRoot\dist\Word2PDF-Batch.exe"
