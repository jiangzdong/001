param(
  [Parameter(Mandatory = $true)]
  [string]$RelativePath,
  [string]$ModelEndpoint = "https://hf-mirror.com"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$checkpointRoot = Join-Path $projectRoot "ditto-validation\ditto-source\checkpoints"
$destination = Join-Path $checkpointRoot ($RelativePath -replace '/', '\')
$bitsDestination = "$destination.bits"
$parent = Split-Path -Parent $destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null

$encodedPath = ($RelativePath -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
$resolverUrl = "$ModelEndpoint/digital-avatar/ditto-talkinghead/resolve/main/${encodedPath}?download=true"
$headers = @()
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  $headers = & curl.exe -sS -I --max-redirs 0 --connect-timeout 15 --max-time 30 $resolverUrl
  if ($LASTEXITCODE -eq 0 -and ($headers | Where-Object { $_ -like "Location:*" })) { break }
  if ($attempt -lt 20) { Start-Sleep -Seconds 5 }
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

$displayName = "Ditto model: $RelativePath"
$existing = Get-BitsTransfer -ErrorAction SilentlyContinue | Where-Object DisplayName -eq $displayName | Select-Object -First 1
if ($existing) {
  if ($existing.JobState -in @('TransientError', 'Suspended')) { Resume-BitsTransfer -BitsJob $existing -Asynchronous }
  $existing | Select-Object DisplayName,JobState,BytesTransferred,BytesTotal | Format-List
  exit 0
}
if (Test-Path -LiteralPath $bitsDestination) {
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Move-Item -LiteralPath $bitsDestination -Destination "$bitsDestination.partial-$stamp"
}
$job = Start-BitsTransfer -Source $location -Destination $bitsDestination -DisplayName $displayName -Description "Official Ditto checkpoint" -Priority Foreground -Asynchronous
$job | Select-Object DisplayName,JobState,BytesTransferred,BytesTotal | Format-List
