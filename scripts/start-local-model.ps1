param([int]$Port = 8081, [switch]$Cpu)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot '.runtime\llama\llama-server.exe'
$modelPath = Join-Path $projectRoot '.models\Qwen3VL-4B-Instruct-Q4_K_M.gguf'
$projectorPath = Join-Path $projectRoot '.models\mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf'
foreach ($filePath in @($serverPath, $modelPath, $projectorPath)) {
    if (-not (Test-Path -LiteralPath $filePath)) { throw "Missing local file: $filePath. Run scripts/prepare-local-model.py during preparation." }
}
$gpuLayers = if ($Cpu) { '0' } else { '99' }
Write-Host "Local vision: http://127.0.0.1:$Port. Model and projector are read from disk; no downloads."
$serverArguments = @('-m', $modelPath, '--mmproj', $projectorPath, '--alias', 'Qwen3-VL-4B-Instruct',
    '--host', '127.0.0.1', '--port', "$Port", '-c', '8192', '-ngl', $gpuLayers,
    '--parallel', '1', '--image-max-tokens', '1280', '--jinja')
if ($Cpu) { $serverArguments += '--no-mmproj-offload' }
& $serverPath @serverArguments
exit $LASTEXITCODE
