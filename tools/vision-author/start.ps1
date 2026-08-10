$ErrorActionPreference = 'Stop'

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $toolRoot '..\..'))
$bootstrapPath = [System.IO.Path]::GetFullPath((Join-Path $toolRoot 'launcher-bootstrap.js'))
$electronPath = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  Write-Error '未找到锁定的 Electron 11.5.0。请先在仓库根运行 npm ci。'
  exit 1
}

$originalNodeOptions = $env:NODE_OPTIONS
$originalBootstrap = $env:VISION_AUTHOR_BOOTSTRAP
$startedAt = [DateTimeOffset]::UtcNow

try {
  $env:NODE_OPTIONS = "--require=$bootstrapPath"
  $env:VISION_AUTHOR_BOOTSTRAP = '1'
  & $electronPath $repoRoot
  $exitCode = $LASTEXITCODE
} finally {
  if ($null -eq $originalNodeOptions) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } else { $env:NODE_OPTIONS = $originalNodeOptions }
  if ($null -eq $originalBootstrap) { Remove-Item Env:VISION_AUTHOR_BOOTSTRAP -ErrorAction SilentlyContinue } else { $env:VISION_AUTHOR_BOOTSTRAP = $originalBootstrap }
}

$elapsed = ([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds
if ($exitCode -ne 0 -or $elapsed -lt 3) {
  Write-Host 'Vision Author 会话未保持运行。若普通 Launcher 已打开，请先关闭它，再从本开发入口重试。'
}
exit $exitCode

