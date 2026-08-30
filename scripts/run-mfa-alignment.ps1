param(
  [Parameter(Mandatory = $true)][string]$AudioPath,
  [Parameter(Mandatory = $true)][string]$TextPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [string]$EnvironmentName = "xiaoan-mfa"
)

$audio = (Resolve-Path -LiteralPath $AudioPath).Path
$text = (Resolve-Path -LiteralPath $TextPath).Path
$output = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $output
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$mfa = Get-Command mfa -ErrorAction SilentlyContinue
if ($mfa) {
  & $mfa.Source align_one $audio $text mandarin_china_mfa mandarin_mfa $output --output_format json --overwrite --single_speaker -j 1
} else {
  $runner = Get-Command mamba -ErrorAction SilentlyContinue
  if (-not $runner) { $runner = Get-Command conda -ErrorAction SilentlyContinue }
  if (-not $runner) { throw "未找到 MFA 或 conda/mamba。请先运行 pnpm mfa:setup。" }
  & $runner.Source run -n $EnvironmentName mfa align_one $audio $text mandarin_china_mfa mandarin_mfa $output --output_format json --overwrite --single_speaker -j 1
}
if ($LASTEXITCODE -ne 0) { throw "MFA 单文件对齐失败。" }
Write-Host "MFA 对齐结果：$output"
