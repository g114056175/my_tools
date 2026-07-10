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
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

& ".\.venv\Scripts\python.exe" -m PyInstaller `
    --noconfirm `
    --clean `
    --windowed `
    --onedir `
    --name Word2PDF-Batch-Folder `
    word2pdf_gui.py

Write-Host ""
Write-Host "Done: $ProjectRoot\dist\Word2PDF-Batch-Folder\Word2PDF-Batch-Folder.exe"
