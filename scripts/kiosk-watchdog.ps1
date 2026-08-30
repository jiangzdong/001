param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [int]$RestartDelaySeconds = 3,
  [int]$MaxRestartsPerHour = 12
)

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable -ErrorAction Stop).Path
$restartTimes = [System.Collections.Generic.Queue[datetime]]::new()

while ($true) {
  $process = Start-Process -FilePath $resolvedExecutable -ArgumentList '--kiosk' -WindowStyle Hidden -PassThru
  $process.WaitForExit()
  if ($process.ExitCode -eq 0) { break }

  $now = Get-Date
  $restartTimes.Enqueue($now)
  while ($restartTimes.Count -gt 0 -and ($now - $restartTimes.Peek()).TotalHours -ge 1) {
    $null = $restartTimes.Dequeue()
  }
  if ($restartTimes.Count -gt $MaxRestartsPerHour) {
    throw "XiaoAn kiosk exceeded $MaxRestartsPerHour restarts within one hour."
  }
  Start-Sleep -Seconds ([Math]::Max(1, $RestartDelaySeconds))
}
