param([switch]$Browser)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
& ".\.venv\Scripts\python.exe" -X utf8 -m pytest -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& ".\.venv\Scripts\python.exe" -X utf8 -m ruff check services tests scripts
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Browser) {
    & npm.cmd run test:ui
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Write-Host "All requested checks passed."
