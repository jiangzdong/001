param(
  [string]$PythonPath = "python",
  [string]$ModelEndpoint = "https://hf-mirror.com",
  [string]$PipIndex = "https://mirrors.aliyun.com/pypi/simple/",
  [string]$OrtCuda11Index = "https://aiinfra.pkgs.visualstudio.com/PublicPackages/_packaging/onnxruntime-cuda-11/pypi/simple/"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$dittoRoot = Join-Path $projectRoot "ditto-validation\ditto-source"
$checkpointRoot = Join-Path $dittoRoot "checkpoints"
$requirements = Join-Path $projectRoot "ditto-validation\local-requirements.txt"
$downloadScript = Join-Path $PSScriptRoot "download-ditto-models-xet.ps1"
$env:NO_PROXY = "*"
$env:no_proxy = "*"

if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw "curl.exe is required" }
& $PythonPath -c "import torch; assert torch.cuda.is_available(), 'CUDA PyTorch is unavailable'; print(torch.__version__, torch.cuda.get_device_name(0))"
if ($LASTEXITCODE -ne 0) { throw "CUDA PyTorch check failed" }

& $PythonPath -m pip install --disable-pip-version-check --index-url $PipIndex -r $requirements
if ($LASTEXITCODE -ne 0) { throw "Ditto Python dependency installation failed" }
& $PythonPath -m pip install --disable-pip-version-check --force-reinstall --no-deps "onnxruntime-gpu==1.20.1" --index-url $OrtCuda11Index
if ($LASTEXITCODE -ne 0) { throw "CUDA 11.8 ONNX Runtime installation failed" }

& $downloadScript -ModelEndpoint $ModelEndpoint
if ($LASTEXITCODE -ne 0) { throw "Model download failed" }

Write-Host "Ditto PyTorch model is ready at $checkpointRoot"
Write-Host "Start it with: pnpm run ditto:local"
