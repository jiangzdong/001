param(
  [string]$PythonPath = "python",
  [int]$Port = 8788,
  [string]$CachePath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dittoRoot = Join-Path $projectRoot "ditto-validation\ditto-source"
$checkpointRoot = Join-Path $dittoRoot "checkpoints"
$modelRoot = Join-Path $checkpointRoot "ditto_pytorch"
$configPath = Join-Path $checkpointRoot "ditto_cfg\v0.4_hubert_cfg_pytorch.pkl"
$sourcePath = Join-Path $projectRoot "ditto-validation\xiaoa-source.png"
$cloudRoot = Join-Path $projectRoot "ditto-validation\cloud"
$cacheRoot = if ($CachePath) { $CachePath } else { Join-Path $env:LOCALAPPDATA "XiaoAnHealthKiosk\ditto-cache" }
$pyxBuildRoot = "C:\xapx"

$required = @($modelRoot, $configPath, $sourcePath)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -gt 0) {
  throw "Ditto local GPU runtime is incomplete. Missing: $($missing -join ', '). Run pnpm run ditto:setup-local first."
}

$gpuCheck = & $PythonPath -c "import torch; assert torch.cuda.is_available(); print(torch.cuda.get_device_name(0)); print(round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1))"
if ($LASTEXITCODE -ne 0) { throw "CUDA PyTorch is unavailable in $PythonPath" }

$env:DITTO_ROOT = $dittoRoot
$env:DITTO_MODEL_ROOT = $modelRoot
$env:DITTO_CONFIG = $configPath
$env:DITTO_SOURCE = $sourcePath
$env:DITTO_CACHE = $cacheRoot
$env:DITTO_PYXBUILD = $pyxBuildRoot
$env:CUDA_MODULE_LOADING = "LAZY"
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128"
$env:PYTHONUNBUFFERED = "1"

Write-Host "Starting XiaoAn Ditto frame stream on http://127.0.0.1:$Port"
Write-Host "GPU: $($gpuCheck[0]) ($($gpuCheck[1]) GB)"
& $PythonPath -m uvicorn --app-dir $cloudRoot ditto_api:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
