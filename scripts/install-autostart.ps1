$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ClientDir = Join-Path $Root 'client'
$Node = (Get-Command node -ErrorAction Stop).Source
$TaskName = 'MCPForWork Client'
$Action = New-ScheduledTaskAction -Execute $Node -Argument '--env-file=.env src\client.mjs' -WorkingDirectory $ClientDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 100 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description 'Connect this Windows PC to the MCPForWork AWS hub.' -Force | Out-Null
Write-Host "Installed scheduled task: $TaskName"
