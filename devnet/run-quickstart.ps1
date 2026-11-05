param(
    [switch]$New
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $Root '.cooo-devnet'
$EnvFile = Join-Path $StateDir 'reviewed-task.env'

Set-Location -LiteralPath $Root
$NodeCommand = if (-not [string]::IsNullOrWhiteSpace($env:COOO_NODE_COMMAND)) {
    $env:COOO_NODE_COMMAND
} else {
    (Get-Command node -ErrorAction Stop).Source
}
& $NodeCommand devnet/status.mjs
if ($LASTEXITCODE -ne 0) {
    throw 'The cooo devnet is not healthy. Keep devnet/start.sh running in another foreground shell.'
}
if ($New -or -not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    & $NodeCommand devnet/provision-env.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Failed to provision the quickstart environment.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules') -PathType Container)) {
    npm ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw 'SDK build failed.' }
& $NodeCommand "--env-file=$EnvFile" examples/reviewed-task-quickstart.mjs
if ($LASTEXITCODE -ne 0) { throw 'Reviewed-task quickstart failed.' }
& $NodeCommand devnet/status.mjs
if ($LASTEXITCODE -ne 0) { throw 'Final devnet status check failed.' }
