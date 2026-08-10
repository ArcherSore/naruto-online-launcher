$ErrorActionPreference = 'Stop'

$toolRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $toolRoot '..\..'))
$entryPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'vision-author-launcher.js'))
$electronPath = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path -LiteralPath $electronPath -PathType Leaf)) {
  Write-Error 'Electron 11.5.0 was not found. Run npm ci from the repository root.'
  exit 1
}
if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
  Write-Error 'Vision Author developer entry was not found. Check that the branch is complete.'
  exit 1
}

$startedAt = [DateTimeOffset]::UtcNow
$quotedEntryPath = '"' + $entryPath + '"'
$launcher = Start-Process -FilePath $electronPath -ArgumentList $quotedEntryPath -WorkingDirectory $repoRoot -PassThru -Wait
$exitCode = $launcher.ExitCode

$elapsed = ([DateTimeOffset]::UtcNow - $startedAt).TotalSeconds
if ($exitCode -ne 0 -or $elapsed -lt 3) {
  Write-Host 'Vision Author did not remain running. Close any normal Launcher instance and retry from this developer entry.'
}
exit $exitCode

