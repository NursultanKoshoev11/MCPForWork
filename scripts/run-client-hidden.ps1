$ErrorActionPreference = 'Stop'
Set-Location 'D:\MCPForWork\client'
$logDir = 'D:\MCPForWork\client\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& 'G:\node.exe' --env-file=.env src\client.mjs *>> 'D:\MCPForWork\client\logs\client.background.log'
exit $LASTEXITCODE
