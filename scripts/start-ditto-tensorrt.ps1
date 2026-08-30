param(
  [int]$Port = 8788,
  [string]$CachePath = "",
  [ValidateRange(4, 50)][int]$SamplingSteps = 6,
  [ValidateRange(640, 1920)][int]$MaxFrameSize = 640
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$validationRoot = Join-Path $projectRoot "ditto-validation"
$dittoRoot = Join-Path $validationRoot "ditto-source"
$modelRoot = Join-Path $dittoRoot "checkpoints\ditto_trt_turing_hybrid"
$configPath = Join-Path $dittoRoot "checkpoints\ditto_cfg\v0.4_hubert_cfg_trt_turing_hybrid.pkl"
$sourcePath = Join-Path $validationRoot "xiaoa-source.png"
$cloudRoot = Join-Path $validationRoot "cloud"
$pythonPath = Join-Path $validationRoot "trt-env\Scripts\python.exe"
$trtRoot = Join-Path $validationRoot "tensorrt\TensorRT-8.6.1.6"
$cacheRoot = if ($CachePath) { $CachePath } else { Join-Path $env:LOCALAPPDATA "XiaoAnHealthKiosk\ditto-cache-trt" }
$pyxBuildRoot = "C:\xapx"

$required = @($pythonPath, $trtRoot, $modelRoot, $configPath, $sourcePath)
$missing = @($required | Where-Object { -not (Test-Path -LiteralPath $_) })
if ($missing.Count -gt 0) {
  throw "Ditto TensorRT runtime is incomplete. Missing: $($missing -join ', ')"
}

$torchLib = & $pythonPath -c "import pathlib,torch; print(pathlib.Path(torch.__file__).parent / 'lib')"
if ($LASTEXITCODE -ne 0) { throw "Cannot locate the PyTorch CUDA runtime" }
$env:PATH = "$(Join-Path $trtRoot 'lib');$torchLib;$env:PATH"
$env:TENSORRT_ROOT = $trtRoot
$env:DITTO_ROOT = $dittoRoot
$env:DITTO_MODEL_ROOT = $modelRoot
$env:DITTO_CONFIG = $configPath
$env:DITTO_SOURCE = $sourcePath
$env:DITTO_CACHE = $cacheRoot
$env:DITTO_PYXBUILD = $pyxBuildRoot
$env:DITTO_PROVIDER = "Ditto TensorRT/PyTorch Hybrid CUDA"
$env:DITTO_SAMPLING_STEPS = [string]$SamplingSteps
$env:DITTO_MAX_SIZE = [string]$MaxFrameSize
$env:DITTO_PREWARM = "1"
$env:CUDA_MODULE_LOADING = "LAZY"
$env:PYTORCH_CUDA_ALLOC_CONF = "max_split_size_mb:128"
$env:PYTHONUNBUFFERED = "1"

& $pythonPath -c "import torch,tensorrt as trt; assert torch.cuda.is_available(); print(f'TensorRT {trt.__version__}; {torch.cuda.get_device_name(0)}')"
if ($LASTEXITCODE -ne 0) { throw "TensorRT CUDA validation failed" }

Write-Host "Starting XiaoAn TensorRT hybrid frame stream on http://127.0.0.1:$Port (steps=$SamplingSteps, maxSize=$MaxFrameSize)"
& $pythonPath -m uvicorn --app-dir $cloudRoot ditto_api:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
