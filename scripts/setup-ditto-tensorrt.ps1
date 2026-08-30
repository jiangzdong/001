param(
  [string]$PythonPath = "C:\Users\Administrator\AppData\Local\Programs\Python\Python310\python.exe",
  [double]$WorkspaceGiB = 2.0
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$validationRoot = Join-Path $projectRoot "ditto-validation"
$dittoRoot = Join-Path $validationRoot "ditto-source"
$downloadRoot = Join-Path $validationRoot "downloads"
$trtZip = Join-Path $downloadRoot "TensorRT-8.6.1.6.Windows10.x86_64.cuda-11.8.zip"
$trtParent = Join-Path $validationRoot "tensorrt"
$trtRoot = Join-Path $trtParent "TensorRT-8.6.1.6"
$extractingRoot = Join-Path $validationRoot "tensorrt.extracting"
$venvRoot = Join-Path $validationRoot "trt-env"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
$cudaWheel = Join-Path $downloadRoot "cuda_python-11.8.3-cp310-cp310-win_amd64.whl"
$pywin32Wheel = Join-Path $downloadRoot "pywin32-312-cp310-cp310-win_amd64.whl"
$onnxRoot = Join-Path $dittoRoot "checkpoints\ditto_onnx"
$engineRoot = Join-Path $dittoRoot "checkpoints\ditto_trt_turing_hybrid"
$configSource = Join-Path $dittoRoot "checkpoints\ditto_cfg\v0.4_hubert_cfg_pytorch.pkl"
$configOutput = Join-Path $dittoRoot "checkpoints\ditto_cfg\v0.4_hubert_cfg_trt_turing_hybrid.pkl"

$requiredDownloads = @{
  $trtZip = 1326392956
  $cudaWheel = 8293354
  $pywin32Wheel = 6926780
}
$invalid = @()
foreach ($entry in $requiredDownloads.GetEnumerator()) {
  if (-not (Test-Path -LiteralPath $entry.Key)) {
    $invalid += "$($entry.Key) (missing; expected $($entry.Value) bytes)"
  } elseif ((Get-Item -LiteralPath $entry.Key).Length -ne $entry.Value) {
    $invalid += "$($entry.Key) ($((Get-Item -LiteralPath $entry.Key).Length)/$($entry.Value) bytes)"
  }
}
if ($invalid.Count -gt 0) { throw "TensorRT downloads are incomplete: $($invalid -join '; ')" }
$requiredOnnx = @("appearance_extractor.onnx", "decoder.onnx", "lmdm_v0.4_hubert.onnx", "motion_extractor.onnx")
$missingOnnx = @($requiredOnnx | Where-Object { -not (Test-Path -LiteralPath (Join-Path $onnxRoot $_)) -or (Get-Item -LiteralPath (Join-Path $onnxRoot $_)).Length -le 0 })
if ($missingOnnx.Count -gt 0) { throw "TensorRT ONNX exports are incomplete: $($missingOnnx -join ', ')" }
if (-not (Test-Path -LiteralPath $trtRoot)) {
  if (Test-Path -LiteralPath $extractingRoot) {
    throw "Previous extraction directory exists: $extractingRoot"
  }
  New-Item -ItemType Directory -Force -Path $extractingRoot | Out-Null
  Expand-Archive -LiteralPath $trtZip -DestinationPath $extractingRoot
  $extracted = Join-Path $extractingRoot "TensorRT-8.6.1.6"
  if (-not (Test-Path -LiteralPath $extracted)) { throw "TensorRT archive layout is invalid" }
  New-Item -ItemType Directory -Force -Path $trtParent | Out-Null
  Move-Item -LiteralPath $extracted -Destination $trtRoot
}

if (-not (Test-Path -LiteralPath $venvPython)) {
  & $PythonPath -m venv --system-site-packages $venvRoot
  if ($LASTEXITCODE -ne 0) { throw "Could not create the TensorRT Python environment" }
}

$trtWheel = Get-ChildItem -LiteralPath (Join-Path $trtRoot "python") -Filter "tensorrt-8.6.1-cp310-none-win_amd64.whl" | Select-Object -First 1
if (-not $trtWheel) { throw "TensorRT CPython 3.10 wheel is missing from the SDK" }
& $venvPython -m pip install --disable-pip-version-check --no-deps $cudaWheel $pywin32Wheel $trtWheel.FullName
if ($LASTEXITCODE -ne 0) { throw "TensorRT Python package installation failed" }
& $venvPython (Join-Path $dittoRoot "scripts\prepare_trt_onnx.py") --source (Join-Path $onnxRoot "lmdm_v0.4_hubert.onnx") --output (Join-Path $onnxRoot "lmdm_v0.4_hubert_trt.onnx")
if ($LASTEXITCODE -ne 0) { throw "TensorRT ONNX graph preparation failed" }

$torchLib = & $venvPython -c "import pathlib,torch; print(pathlib.Path(torch.__file__).parent / 'lib')"
$env:PATH = "$(Join-Path $trtRoot 'lib');$torchLib;$env:PATH"
$env:TENSORRT_ROOT = $trtRoot
& $venvPython -c "import torch,tensorrt as trt; from cuda import cudart; assert torch.cuda.is_available(); print(trt.__version__); print(torch.cuda.get_device_name(0)); print(cudart.cudaRuntimeGetVersion())"
if ($LASTEXITCODE -ne 0) { throw "TensorRT could not load with the local CUDA 11.8 runtime" }

& $venvPython (Join-Path $dittoRoot "scripts\cvt_onnx_to_trt_windows.py") --onnx-dir $onnxRoot --trt-dir $engineRoot --trt-root $trtRoot --workspace-gib $WorkspaceGiB
if ($LASTEXITCODE -ne 0) { throw "TensorRT engine conversion failed" }

$validationCases = @(
  @{ Model = "appearance_extractor"; Onnx = "appearance_extractor.onnx"; Engine = "appearance_extractor_fp32.engine" },
  @{ Model = "motion_extractor"; Onnx = "motion_extractor.onnx"; Engine = "motion_extractor_fp32.engine" },
  @{ Model = "lmdm_v0.4_hubert"; Onnx = "lmdm_v0.4_hubert_trt.onnx"; Engine = "lmdm_v0.4_hubert_fp32.engine" },
  @{ Model = "decoder"; Onnx = "decoder.onnx"; Engine = "decoder_fp32.engine" }
)
foreach ($case in $validationCases) {
  & $venvPython (Join-Path $dittoRoot "scripts\validate_trt_engine.py") `
    --model $case.Model `
    --onnx (Join-Path $onnxRoot $case.Onnx) `
    --engine (Join-Path $engineRoot $case.Engine) `
    --max-abs 0.001 `
    --mean-abs 0.0001
  if ($LASTEXITCODE -ne 0) { throw "TensorRT numerical validation failed: $($case.Model)" }
}
& $venvPython (Join-Path $dittoRoot "scripts\create_trt_turing_hybrid_config.py") --source $configSource --output $configOutput
if ($LASTEXITCODE -ne 0) { throw "TensorRT hybrid config creation failed" }

Write-Host "Ditto TensorRT Turing hybrid runtime is ready: $engineRoot"
Write-Host "Start it with: pnpm run ditto:local-trt"
