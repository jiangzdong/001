param(
  [Parameter(Mandatory = $true)]
  [string]$RelativePath,
  [string]$ModelEndpoint = "https://hf-mirror.com",
  [string]$CdnAddress = ""
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
if (-not ($headers | Where-Object { $_ -like "Location:*" })) { throw "Cannot resolve model URL: $RelativePath" }

$locationLine = $headers | Where-Object { $_ -like "Location:*" } | Select-Object -First 1
$sizeLine = $headers | Where-Object { $_ -like "X-Linked-Size:*" } | Select-Object -First 1
if (-not $locationLine -or -not $sizeLine) { throw "Model metadata is incomplete: $RelativePath" }
$location = $locationLine.Substring(9).Trim()
$expectedSize = [int64]$sizeLine.Substring(14).Trim()
$existingSize = if (Test-Path -LiteralPath $destination) { (Get-Item -LiteralPath $destination).Length } else { 0 }

if ($existingSize -eq $expectedSize) {
  Write-Host "Already complete: $RelativePath ($expectedSize bytes)"
  exit 0
}
if ($existingSize -gt $expectedSize) {
  $invalidPath = "$destination.invalid-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  Move-Item -LiteralPath $destination -Destination $invalidPath
  $existingSize = 0
}

$signedUri = [Uri]$location
$addresses = Resolve-DnsName $signedUri.Host -Type A | Select-Object -ExpandProperty IPAddress -Unique
if (-not $addresses) { throw "Cannot resolve CDN host: $($signedUri.Host)" }
$address = if ($CdnAddress) { $CdnAddress } else { $addresses | Select-Object -First 1 }
$resolve = "$($signedUri.Host):443:$address"

Write-Host "Downloading $RelativePath from byte $existingSize of $expectedSize"
& curl.exe -4 --http1.1 --fail --connect-timeout 10 --speed-time 60 --speed-limit 1024 --retry 5 --retry-delay 2 --resolve $resolve --continue-at $existingSize --output $destination $location
if ($LASTEXITCODE -ne 0) { throw "Model download failed: $RelativePath" }

$actualSize = (Get-Item -LiteralPath $destination).Length
if ($actualSize -ne $expectedSize) { throw "Model size mismatch for ${RelativePath}: expected $expectedSize, got $actualSize" }
Write-Host "Verified $RelativePath ($actualSize bytes)"
