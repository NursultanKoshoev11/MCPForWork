$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ClientDir = Join-Path $Root 'client'
$PidFile = Join-Path $ClientDir 'client.pid'
$LogDir = Join-Path $ClientDir 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path $PidFile) {
    $ExistingPid = (Get-Content $PidFile -Raw).Trim()
    if ($ExistingPid -match '^\d+$' -and (Get-Process -Id ([int]$ExistingPid) -ErrorAction SilentlyContinue)) {
        Write-Host "MCPForWork client is already running (PID $ExistingPid)"
        exit 0
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$Node = (Get-Command node -ErrorAction Stop).Source
$StdOut = Join-Path $LogDir 'client.out.log'
$StdErr = Join-Path $LogDir 'client.err.log'

$Process = Start-Process -FilePath $Node `
    -ArgumentList @('--env-file=.env', 'src/client.mjs') `
    -WorkingDirectory $ClientDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdOut `
    -RedirectStandardError $StdErr `
    -PassThru

Start-Sleep -Seconds 2
if ($Process.HasExited) {
    Write-Error "Client exited immediately. See $StdErr"
}
Write-Host "MCPForWork client started (PID $($Process.Id))"
