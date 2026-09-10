Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\MCPForWork\client"
Do
  rc = sh.Run("""G:\node.exe"" --env-file=.env src\client.mjs", 0, True)
  WScript.Sleep 5000
Loop
