param(
  [string]$FlexHome = $env:FLEX_HOME,
  [string]$TargetPlayer = '32.0'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($FlexHome)) {
  throw 'Apache Flex SDK not found. Pass -FlexHome or set FLEX_HOME.'
}

$compiler = Join-Path $FlexHome 'bin\mxmlc.bat'
$playerGlobal = Join-Path $FlexHome "frameworks\libs\player\$TargetPlayer\playerglobal.swc"
if (-not (Test-Path -LiteralPath $compiler)) {
  throw "mxmlc.bat not found: $compiler"
}
if (-not (Test-Path -LiteralPath $playerGlobal)) {
  throw "playerglobal.swc not found: $playerGlobal"
}

$source = Join-Path $PSScriptRoot 'CdpClickTarget.as'
$output = Join-Path $PSScriptRoot 'CdpClickTarget.swf'

& $compiler `
  '-debug=false' `
  '-omit-trace-statements=true' `
  '-static-link-runtime-shared-libraries=true' `
  "-target-player=$TargetPlayer" `
  "-output=$output" `
  $source

if ($LASTEXITCODE -ne 0) {
  throw "mxmlc failed with exit code $LASTEXITCODE"
}

Write-Output "Built $output (target player $TargetPlayer)"
