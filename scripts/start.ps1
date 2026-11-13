param([switch]$Dev)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $pythonPath)) { throw "Create .venv and install requirements.txt first. See README.md." }
foreach ($keyName in @("VISION_API_KEY", "AGENTROUTER_API_KEY")) {
    $userValue = [Environment]::GetEnvironmentVariable($keyName, "User")
    if ($userValue -and -not [Environment]::GetEnvironmentVariable($keyName, "Process")) { [Environment]::SetEnvironmentVariable($keyName, $userValue, "Process") }
}
if ($Dev) {
    Write-Host "API: http://127.0.0.1:8000. Run npm run dev in another terminal for http://127.0.0.1:5173."
} elseif (-not (Test-Path -LiteralPath "apps\web\dist\index.html")) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
}
& $pythonPath -X utf8 -m uvicorn app.main:create_app --factory --app-dir services/api --host 127.0.0.1 --port 8000
exit $LASTEXITCODE
