$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root 'client\client.pid'
if (!(Test-Path $PidFile)) {
    Write-Host 'MCPForWork client is not running (no PID file)'
    exit 0
}
$PidValue = (Get-Content $PidFile -Raw).Trim()
if ($PidValue -match '^\d+$') {
    Stop-Process -Id ([int]$PidValue) -Force -ErrorAction SilentlyContinue
}
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host 'MCPForWork client stopped'
