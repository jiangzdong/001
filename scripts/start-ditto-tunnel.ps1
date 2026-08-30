param(
  [string]$RemoteHost = "connect.westb.seetacloud.com",
  [int]$RemotePort = 16768,
  [int]$LocalPort = 8788,
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".ssh\id_ed25519_xiaoan_ditto")
)

$ErrorActionPreference = "Stop"

try {
  $status = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/health" -TimeoutSec 2
  if ($status.ok) {
    Write-Host "Ditto cloud connection is ready."
    exit 0
  }
} catch {}

if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
  throw "Ditto SSH key was not found: $KeyPath"
}

$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$arguments = @(
  "-N",
  "-T",
  "-o", "BatchMode=yes",
  "-o", "ExitOnForwardFailure=yes",
  "-o", "ServerAliveInterval=30",
  "-o", "ServerAliveCountMax=3",
  "-i", $KeyPath,
  "-p", "$RemotePort",
  "-L", "${LocalPort}:127.0.0.1:8788",
  "root@$RemoteHost"
)

Start-Process -FilePath $ssh -ArgumentList $arguments -WindowStyle Hidden

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$LocalPort/health" -TimeoutSec 2
    if ($status.ok) {
      Write-Host "Ditto cloud connection established: $($status.gpu)"
      exit 0
    }
  } catch {}
}

throw "The SSH tunnel started, but Ditto did not respond within 10 seconds. Confirm that the cloud host is running."
