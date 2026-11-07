' Abre la Watchlist sin ventana de consola. Es lo que ejecuta el acceso directo.
' Busca actualizaciones en GitHub y abre la ventana de la app.
Option Explicit
Dim fso, sh, env, root, home, nodeDir, logFile, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
Set env = sh.Environment("PROCESS")

' <home>\app\apps\desktop\launch\watchlist.vbs -> <home>\app
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))))
home = fso.GetParentFolderName(root)

' Node.js propio de la app (lo descarga instalar.bat); si no esta, se usa el del sistema.
nodeDir = home & "\node"
If fso.FileExists(nodeDir & "\node.exe") Then env("PATH") = nodeDir & ";" & env("PATH")

logFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\watchlist-launch.log"
sh.CurrentDirectory = root
rc = sh.Run("cmd /c node ""apps\desktop\launch\launch.mjs"" > """ & logFile & """ 2>&1", 0, True)

If rc <> 0 Then
  MsgBox "No se pudo abrir Watchlist." & vbCrLf & vbCrLf & _
         "Prueba a ejecutar de nuevo instalar.bat." & vbCrLf & _
         "Detalles del error en:" & vbCrLf & logFile, vbExclamation, "Watchlist"
End If
