Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\MCPForWork\scripts\run-client-hidden.ps1"""
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
