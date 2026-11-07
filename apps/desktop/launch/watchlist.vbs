' Abre la Watchlist sin ventana de consola. Es lo que ejecuta el acceso directo.
' Busca actualizaciones en GitHub y abre la ventana de la app.
Option Explicit
Dim fso, sh, root, logFile, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

' ...\apps\desktop\launch\watchlist.vbs -> raiz del proyecto
root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))))
logFile = sh.ExpandEnvironmentStrings("%TEMP%") & "\watchlist-launch.log"

sh.CurrentDirectory = root
rc = sh.Run("cmd /c node ""apps\desktop\launch\launch.mjs"" > """ & logFile & """ 2>&1", 0, True)

If rc <> 0 Then
  MsgBox "No se pudo abrir Watchlist." & vbCrLf & vbCrLf & _
         "Si es la primera vez en este PC, ejecuta instalar.bat." & vbCrLf & _
         "Detalles del error en:" & vbCrLf & logFile, vbExclamation, "Watchlist"
End If
