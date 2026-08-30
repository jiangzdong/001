param([int]$TimeoutMinutes = 240)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$checkpointRoot = Join-Path $projectRoot "ditto-validation\ditto-source\checkpoints"
$expected = [ordered]@{
  "ditto_pytorch/aux_models/hubert_streaming_fix_kv.onnx" = 1460740880
  "ditto_pytorch/models/decoder.pth" = 221813590
  "ditto_pytorch/models/lmdm_v0.4_hubert.pth" = 191247715
  "ditto_pytorch/models/warp_network.pth" = 182180086
}
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)

while ((Get-Date) -lt $deadline) {
  $jobs = @(Get-BitsTransfer -AllUsers -ErrorAction SilentlyContinue | Where-Object DisplayName -like "Ditto model:*")
  foreach ($job in $jobs) {
    $relativePath = $job.DisplayName.Substring("Ditto model: ".Length)
    if (-not $expected.Contains($relativePath)) { continue }
    if ($job.JobState -eq "Transferred") {
      Complete-BitsTransfer -BitsJob $job
      $destination = Join-Path $checkpointRoot ($relativePath -replace '/', '\')
      $bitsDestination = "$destination.bits"
      $expectedSize = [int64]$expected[$relativePath]
      if (-not (Test-Path -LiteralPath $bitsDestination)) { throw "BITS file missing: $bitsDestination" }
      $actualSize = (Get-Item -LiteralPath $bitsDestination).Length
      if ($actualSize -ne $expectedSize) { throw "BITS size mismatch for ${relativePath}: expected $expectedSize, got $actualSize" }
      if (Test-Path -LiteralPath $destination) {
        $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        Move-Item -LiteralPath $destination -Destination "$destination.partial-$stamp"
      }
      Move-Item -LiteralPath $bitsDestination -Destination $destination
      Write-Host "Verified $relativePath ($actualSize bytes)"
    } elseif ($job.JobState -in @("TransientError", "Suspended")) {
      Resume-BitsTransfer -BitsJob $job -Asynchronous
    } elseif ($job.JobState -eq "Error") {
      throw "BITS failed for ${relativePath}: $($job.ErrorDescription)"
    }
  }

  $remaining = @()
  foreach ($entry in $expected.GetEnumerator()) {
    $path = Join-Path $checkpointRoot ($entry.Key -replace '/', '\')
    $actual = if (Test-Path -LiteralPath $path) { (Get-Item -LiteralPath $path).Length } else { -1 }
    if ($actual -ne [int64]$entry.Value) { $remaining += $entry.Key }
  }
  if ($remaining.Count -eq 0) {
    Write-Host "All Ditto BITS model files verified."
    exit 0
  }

  $active = @(Get-BitsTransfer -AllUsers -ErrorAction SilentlyContinue | Where-Object DisplayName -like "Ditto model:*")
  $active | Select-Object DisplayName,JobState,BytesTransferred,BytesTotal | Sort-Object DisplayName | Format-Table -AutoSize
  Start-Sleep -Seconds 30
}
throw "Ditto BITS downloads did not complete within $TimeoutMinutes minutes"
