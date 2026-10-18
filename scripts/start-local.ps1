param(
  [ValidateSet('start', 'api', 'ui')]
  [string]$Mode = 'start',
  [string]$NodePath,
  [string]$NpmCliPath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Find-LocalTooling {
  $npmCliOverride = if ($NpmCliPath) { $NpmCliPath } else { $env:TABLETOP_NPM_CLI_PATH }
  if ($NodePath -and (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    $nodeCandidates = @($NodePath)
  } else {
    $nodeCandidates = @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object Source) |
      Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -Unique
  }

  foreach ($candidateNode in $nodeCandidates) {
    $nodeDirectory = Split-Path -Parent $candidateNode
    $parentDirectory = Split-Path -Parent $nodeDirectory
    $cliCandidates = @(
      $npmCliOverride,
      (Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'),
      (Join-Path $parentDirectory 'node_modules\npm\bin\npm-cli.js'),
      (Join-Path $env:APPDATA 'npm\node_modules\npm\bin\npm-cli.js')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
    $cli = $cliCandidates | Select-Object -First 1
    if ($cli) { return @{ Node = $candidateNode; NpmCli = $cli } }
  }

  throw 'Could not locate node.exe with its installed npm CLI. Set TABLETOP_NPM_CLI_PATH or repair the Node installation.'
}

$tooling = Find-LocalTooling
Set-Location $projectRoot

if ($Mode -eq 'api' -or $Mode -eq 'start') {
  if ($env:DATABASE_URL) { throw 'Local mode refuses DATABASE_URL. Unset it before starting the local API.' }
  $env:TABLETOP_ENV = 'local'
  $env:NODE_ENV = 'development'
  $env:HOST = '127.0.0.1'
  $env:PORT = '4310'
  $env:TABLETOP_DATA_DIR = Join-Path $projectRoot 'server\.data'
  if ($Mode -eq 'start') {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Build the app before starting: npm run build' }
    & $tooling.Node $tooling.NpmCli start
  } else {
    & $tooling.Node $tooling.NpmCli run dev:api
  }
  exit $LASTEXITCODE
}

& $tooling.Node $tooling.NpmCli run dev
exit $LASTEXITCODE
