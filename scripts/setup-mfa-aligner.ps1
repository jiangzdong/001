param(
  [string]$EnvironmentName = "xiaoan-mfa"
)

$runner = Get-Command mamba -ErrorAction SilentlyContinue
if (-not $runner) { $runner = Get-Command conda -ErrorAction SilentlyContinue }
if (-not $runner) {
  throw "未找到 conda/mamba。请先安装 Miniforge，再重新运行 pnpm mfa:setup。"
}

& $runner.Source run -n $EnvironmentName mfa --help *> $null
if ($LASTEXITCODE -ne 0) {
  & $runner.Source create -n $EnvironmentName -c conda-forge montreal-forced-aligner -y
  if ($LASTEXITCODE -ne 0) { throw "MFA 环境创建失败。" }
}

& $runner.Source run -n $EnvironmentName mfa model download dictionary mandarin_china_mfa
if ($LASTEXITCODE -ne 0) { throw "普通话词典下载失败。" }
& $runner.Source run -n $EnvironmentName mfa model download acoustic mandarin_mfa
if ($LASTEXITCODE -ne 0) { throw "普通话声学模型下载失败。" }
Write-Host "MFA 已就绪：环境 $EnvironmentName，词典 mandarin_china_mfa，声学模型 mandarin_mfa。"
