param(
  [Parameter(Mandatory = $true)]
  [string]$RelativePath,
  [string]$ModelEndpoint = "https://hf-mirror.com",
  [string[]]$CdnAddress = @(),
  [int]$Workers = 8,
  [int]$ChunkSizeMB = 4
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$checkpointRoot = Join-Path $projectRoot "ditto-validation\ditto-source\checkpoints"
$destination = Join-Path $checkpointRoot ($RelativePath -replace '/', '\')
$parent = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null

$encodedPath = ($RelativePath -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
$resolverUrl = "$ModelEndpoint/digital-avatar/ditto-talkinghead/resolve/main/${encodedPath}?download=true"
$headers = @()
for ($attempt = 1; $attempt -le 6; $attempt += 1) {
  $headers = & curl.exe -sS -I --max-redirs 0 --connect-timeout 30 --max-time 75 $resolverUrl
  if ($LASTEXITCODE -eq 0 -and ($headers | Where-Object { $_ -like "Location:*" })) { break }
  if ($attempt -lt 6) { Start-Sleep -Seconds 3 }
}

$locationLine = $headers | Where-Object { $_ -like "Location:*" } | Select-Object -First 1
$sizeLine = $headers | Where-Object { $_ -like "X-Linked-Size:*" } | Select-Object -First 1
if (-not $locationLine -or -not $sizeLine) { throw "Cannot resolve model metadata: $RelativePath" }
$location = $locationLine.Substring(9).Trim()
$expectedSize = [int64]$sizeLine.Substring(14).Trim()
if ((Test-Path -LiteralPath $destination) -and (Get-Item -LiteralPath $destination).Length -eq $expectedSize) {
  Write-Host "Already complete: $RelativePath ($expectedSize bytes)"
  exit 0
}

$signedUri = [Uri]$location
$resolvedAddresses = @(Resolve-DnsName $signedUri.Host -Type A | Select-Object -ExpandProperty IPAddress -Unique)
$cdnAddresses = if ($CdnAddress.Count -gt 0) { @($CdnAddress) } else { $resolvedAddresses }
if ($cdnAddresses.Count -eq 0) { throw "Cannot resolve CDN host: $($signedUri.Host)" }
Write-Host "CDN addresses: $($cdnAddresses -join ', ')"
$chunkSize = [int64]$ChunkSizeMB * 1024 * 1024
$chunkCount = [math]::Ceiling($expectedSize / $chunkSize)
$partsDir = "$destination.parts"
New-Item -ItemType Directory -Force -Path $partsDir | Out-Null

Write-Host "Downloading $RelativePath in $chunkCount chunks with $Workers workers"
$jobs = @()
for ($worker = 0; $worker -lt $Workers; $worker += 1) {
  $workerAddress = $cdnAddresses[$worker % $cdnAddresses.Count]
  $resolve = "$($signedUri.Host):443:$workerAddress"
  $jobs += Start-Job -ScriptBlock {
    param($location, $resolve, $partsDir, $expectedSize, $chunkSize, $chunkCount, $worker, $workers)
    $ErrorActionPreference = "Stop"
    for ($index = $worker; $index -lt $chunkCount; $index += $workers) {
      $start = [int64]$index * $chunkSize
      $end = [math]::Min($expectedSize - 1, $start + $chunkSize - 1)
      $partLength = $end - $start + 1
      $part = Join-Path $partsDir ("part-{0:D5}.bin" -f $index)
      if ((Test-Path -LiteralPath $part) -and (Get-Item -LiteralPath $part).Length -eq $partLength) { continue }
      $tempPart = "$part.downloading"
      & curl.exe -4 --http1.1 -sS --fail --connect-timeout 10 --speed-time 45 --speed-limit 1024 --resolve $resolve --range "$start-$end" --output $tempPart $location
      if ($LASTEXITCODE -ne 0) { throw "Chunk $index download failed" }
      $actualPartLength = (Get-Item -LiteralPath $tempPart).Length
      if ($actualPartLength -ne $partLength) { throw "Chunk $index size mismatch: expected $partLength, got $actualPartLength" }
      Move-Item -LiteralPath $tempPart -Destination $part -Force
    }
  } -ArgumentList $location, $resolve, $partsDir, $expectedSize, $chunkSize, $chunkCount, $worker, $Workers
}

$jobs | Wait-Job | Out-Null
$jobs | Receive-Job
$failedJobs = @($jobs | Where-Object State -ne "Completed")
$jobs | Remove-Job -Force
if ($failedJobs.Count -gt 0) { throw "$($failedJobs.Count) download workers failed; rerun to continue missing chunks" }

for ($index = 0; $index -lt $chunkCount; $index += 1) {
  $start = [int64]$index * $chunkSize
  $end = [math]::Min($expectedSize - 1, $start + $chunkSize - 1)
  $part = Join-Path $partsDir ("part-{0:D5}.bin" -f $index)
  if (-not (Test-Path -LiteralPath $part) -or (Get-Item -LiteralPath $part).Length -ne ($end - $start + 1)) {
    throw "Chunk set is incomplete at index $index; rerun to continue"
  }
}

$assembling = "$destination.assembling"
$output = [System.IO.File]::Open($assembling, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
  for ($index = 0; $index -lt $chunkCount; $index += 1) {
    $part = Join-Path $partsDir ("part-{0:D5}.bin" -f $index)
    $input = [System.IO.File]::OpenRead($part)
    try { $input.CopyTo($output) } finally { $input.Dispose() }
  }
} finally {
  $output.Dispose()
}

$actualSize = (Get-Item -LiteralPath $assembling).Length
if ($actualSize -ne $expectedSize) { throw "Assembled model size mismatch: expected $expectedSize, got $actualSize" }
if (Test-Path -LiteralPath $destination) {
  Move-Item -LiteralPath $destination -Destination "$destination.partial-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
}
Move-Item -LiteralPath $assembling -Destination $destination

$checkpointFull = [System.IO.Path]::GetFullPath($checkpointRoot)
$partsFull = [System.IO.Path]::GetFullPath($partsDir)
if (-not $partsFull.StartsWith($checkpointFull, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe parts path: $partsFull" }
Get-ChildItem -LiteralPath $partsDir -File | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
Remove-Item -LiteralPath $partsDir -Force
Write-Host "Verified $RelativePath ($actualSize bytes)"
