param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [switch]$Remove
)

$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'XiaoAn Health Kiosk.lnk'

if ($Remove) {
  Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
  Write-Output "Removed: $shortcutPath"
  exit 0
}

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable -ErrorAction Stop).Path
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $resolvedExecutable
$shortcut.Arguments = '--kiosk'
$shortcut.WorkingDirectory = Split-Path -Parent $resolvedExecutable
$shortcut.Description = '小安数字健康管理师开机启动'
$shortcut.Save()
Write-Output "Created: $shortcutPath"
