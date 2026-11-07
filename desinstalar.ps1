# Desinstalador de Watchlist (se lanza desde Configuración > Aplicaciones instaladas).
# Borra el programa, su Node.js, los accesos directos y el registro. Los datos se conservan
# salvo que el usuario pida borrarlos (y nunca si están en una carpeta externa/compartida).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$appDir = $PSScriptRoot
$installDir = Split-Path $appDir
$auto = [bool]$env:WATCHLIST_UNINSTALL_YES   # pruebas: sin preguntas, conserva los datos

function Ask($text, $default = 'No') {
  if ($auto) { return $default -eq 'Yes' }
  $buttons = [System.Windows.Forms.MessageBoxButtons]::YesNo
  $icon = [System.Windows.Forms.MessageBoxIcon]::Question
  $def = if ($default -eq 'Yes') { 'Button1' } else { 'Button2' }
  return [System.Windows.Forms.MessageBox]::Show($text, 'Desinstalar Watchlist', $buttons, $icon, $def) -eq 'Yes'
}

if (-not (Ask "¿Desinstalar Watchlist de este PC?`n`nSe borrará el programa de:`n$installDir" 'Yes')) { exit 0 }

$cfgFile = Join-Path $appDir 'watchlist.local.json'
$dataDir = if (Test-Path $cfgFile) { (Get-Content $cfgFile -Raw | ConvertFrom-Json).dataDir } else { $null }

# Cerrar la app si está abierta.
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir\*" } | ForEach-Object {
  [void]$_.CloseMainWindow(); Start-Sleep -Seconds 2; if (-not $_.HasExited) { $_ | Stop-Process -Force }
}

# Accesos directos que apuntan a esta instalación.
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), $env:WATCHLIST_SHORTCUT_DIR)) {
  if (-not $dir) { continue }
  $lnk = Join-Path $dir 'Watchlist.lnk'
  if ((Test-Path $lnk) -and ($shell.CreateShortcut($lnk).Arguments -like "*$appDir*")) { Remove-Item $lnk -Force }
}

# Datos: solo se ofrecen borrar si están dentro de la carpeta de instalación.
$dataInside = $dataDir -and ($dataDir -like "$installDir\*")
$deleteData = $false
if ($dataInside -and (Test-Path $dataDir)) {
  $deleteData = Ask "¿Borrar también tus datos (listas, valores y copias)?`n`n$dataDir`n`nSi dices que no, se conservan para una futura instalación."
}

Set-Location $env:TEMP
Remove-Item -Recurse -Force (Join-Path $installDir 'node') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $appDir -ErrorAction SilentlyContinue
if ($deleteData) { Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue }
if ((Test-Path $installDir) -and -not (Get-ChildItem $installDir -Force)) { Remove-Item $installDir -Force }

if (-not $env:WATCHLIST_NO_REGISTRY) {
  Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Watchlist' -Recurse -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\Software\Watchlist' -Recurse -ErrorAction SilentlyContinue
}

$msg = 'Watchlist se ha desinstalado.'
if ($dataDir -and -not $deleteData -and (Test-Path $dataDir)) { $msg += "`n`nTus datos se conservan en:`n$dataDir" }
if (-not $auto) { [void][System.Windows.Forms.MessageBox]::Show($msg, 'Watchlist') } else { Write-Host $msg }
