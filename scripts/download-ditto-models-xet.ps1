param(
  [string]$ModelEndpoint = "https://hf-mirror.com",
  [int]$RetryMinutes = 30
)

$ErrorActionPreference = "Continue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$checkpointRoot = Join-Path $projectRoot "ditto-validation\ditto-source\checkpoints"
New-Item -ItemType Directory -Force -Path $checkpointRoot | Out-Null

$env:HF_ENDPOINT = $ModelEndpoint
$env:HF_HUB_DOWNLOAD_TIMEOUT = "60"
$env:HF_HUB_ETAG_TIMEOUT = "15"
$env:HF_XET_HIGH_PERFORMANCE = "1"
$env:NO_PROXY = "*"
$env:no_proxy = "*"

$expected = [ordered]@{
  "ditto_cfg/v0.4_hubert_cfg_pytorch.pkl" = 31002
  "ditto_pytorch/aux_models/2d106det.onnx" = 5030888
  "ditto_pytorch/aux_models/det_10g.onnx" = 16923827
  "ditto_pytorch/aux_models/face_landmarker.task" = 3758596
  "ditto_pytorch/aux_models/hubert_streaming_fix_kv.onnx" = 1460740880
  "ditto_pytorch/aux_models/landmark203.onnx" = 114666491
  "ditto_pytorch/models/appearance_extractor.pth" = 3387959
  "ditto_pytorch/models/decoder.pth" = 221813590
  "ditto_pytorch/models/lmdm_v0.4_hubert.pth" = 191247715
  "ditto_pytorch/models/motion_extractor.pth" = 112545506
  "ditto_pytorch/models/stitch_network.pth" = 2393098
  "ditto_pytorch/models/warp_network.pth" = 182180086
}

$attempts = [math]::Max(1, $RetryMinutes * 2)
$errors = @()
$complete = $false
for ($attempt = 1; $attempt -le $attempts; $attempt += 1) {
  Write-Host "Ditto Xet download attempt $attempt of $attempts"
  & curl.exe -4 -sS -L --connect-timeout 8 --max-time 15 -o NUL "$ModelEndpoint/api/models/digital-avatar/ditto-talkinghead"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Model mirror is not reachable yet."
    if ($attempt -lt $attempts) { Start-Sleep -Seconds 30 }
    continue
  }
  $pending = @()
  foreach ($entry in $expected.GetEnumerator()) {
    $path = Join-Path $checkpointRoot ($entry.Key -replace '/', '\')
    $actual = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length } else { -1 }
    if ($actual -ne [int64]$entry.Value) { $pending += $entry.Key }
  }
  if ($pending.Count -eq 0) { $complete = $true; break }
  Write-Host "Downloading $($pending.Count) missing or incomplete model files."
  & hf download digital-avatar/ditto-talkinghead $pending --local-dir $checkpointRoot --max-workers ([math]::Min(2, $pending.Count))
  $errors = @()
  foreach ($entry in $expected.GetEnumerator()) {
    $path = Join-Path $checkpointRoot ($entry.Key -replace '/', '\')
    $actual = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length } else { -1 }
    if ($actual -ne [int64]$entry.Value) { $errors += "$($entry.Key): expected $($entry.Value), got $actual" }
  }
  if ($errors.Count -eq 0) { $complete = $true; break }
  Write-Host "Model set is still incomplete ($($errors.Count) files)."
  if ($attempt -lt $attempts) { Start-Sleep -Seconds 30 }
}
if (-not $complete) { throw "Ditto Xet download did not complete within $RetryMinutes minutes" }
Write-Host "Ditto PyTorch model verified: 2314719638 bytes"
