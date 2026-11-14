$ErrorActionPreference = 'Stop'
Write-Host 'TradePulse Precision 15 preflight' -ForegroundColor Cyan
if (-not (Test-Path '.env')) { throw 'Missing .env. Copy .env.example to .env and configure it.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed or not in PATH.' }
$nodeVersion = node --version
Write-Host "Node: $nodeVersion"
if (-not (Test-Path 'node_modules')) { Write-Host 'Dependencies not installed. Run npm install.' -ForegroundColor Yellow }
Write-Host 'Preflight complete. Live order placement must remain disabled until broker and exchange checks are completed.' -ForegroundColor Green
