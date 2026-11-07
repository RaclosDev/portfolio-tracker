# Instalador de Watchlist para Windows (lo ejecuta instalar.bat).
#  1. Pregunta dónde instalar (por defecto %LOCALAPPDATA%\Watchlist).
#  2. Descarga un Node.js portátil dentro de esa carpeta (sin permisos de administrador).
#  3. Copia el programa, instala dependencias, pregunta la carpeta de datos y crea accesos directos.
#  4. Registra la app en "Aplicaciones instaladas" (solo para este usuario) con su desinstalador.
$ErrorActionPreference = 'Stop'
$NodeVersion = '24.16.0'
$src = $PSScriptRoot
$regKey = 'HKCU:\Software\Watchlist'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Watchlist'
Add-Type -AssemblyName System.Windows.Forms

function Write-Step($n, $text) { Write-Host ''; Write-Host " $n  $text" -ForegroundColor Cyan }

function Select-Folder($description, $initial) {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = $description
  $dialog.ShowNewFolderButton = $true
  if ($initial -and (Test-Path $initial)) { $dialog.SelectedPath = $initial }
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  if ($dialog.ShowDialog($owner) -eq 'OK') { return $dialog.SelectedPath }
  return $null
}

Write-Host ''
Write-Host ' =============================='
Write-Host '   Instalar Watchlist'
Write-Host ' =============================='

# ---------- 1. Carpeta de instalación ----------
$previous = (Get-ItemProperty $regKey -ErrorAction SilentlyContinue).InstallDir
if ($env:WATCHLIST_HOME) {
  $installDir = $env:WATCHLIST_HOME
} else {
  $default = if ($previous) { $previous } else { Join-Path $env:LOCALAPPDATA 'Watchlist' }
  Write-Host ''
  Write-Host " Elige dónde instalar Watchlist (se usará una carpeta 'Watchlist' dentro)."
  Write-Host " Si cierras la ventana sin elegir, se instala en: $default"
  $chosen = Select-Folder "Elige dónde instalar Watchlist. Dentro se creará la carpeta 'Watchlist'." (Split-Path $default)
  if (-not $chosen) { $installDir = $default }
  elseif ((Split-Path $chosen -Leaf) -eq 'Watchlist') { $installDir = $chosen }
  else { $installDir = Join-Path $chosen 'Watchlist' }
}
$env:WATCHLIST_HOME = $installDir
New-Item -ItemType Directory -Force $installDir | Out-Null
Write-Host " Instalando en: $installDir"
if ($previous -and $previous -ne $installDir) {
  Write-Host " (Había una instalación anterior en $previous; puedes borrarla desde Aplicaciones instaladas.)" -ForegroundColor Yellow
}

# Cerrar la app si está abierta desde esta carpeta (para poder actualizar sus ficheros).
$running = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir\*" }
if ($running) {
  Write-Host ' Cerrando Watchlist para actualizarla...'
  $running | ForEach-Object { [void]$_.CloseMainWindow() }
  Start-Sleep -Seconds 3
  Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir\*" } | Stop-Process -Force
}

# ---------- 2. Node.js portátil ----------
$nodeDir = Join-Path $installDir 'node'
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  Write-Step '' "Descargando Node.js $NodeVersion (solo la primera vez, unos 35 MB)..."
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $pkg = "node-v$NodeVersion-win-$arch"
  $zip = Join-Path $env:TEMP "$pkg.zip"
  & "$env:SystemRoot\System32\curl.exe" -L --fail --progress-bar -o $zip "https://nodejs.org/dist/v$NodeVersion/$pkg.zip"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar Node.js. Comprueba la conexión a internet.' }
  & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $installDir
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo descomprimir Node.js.' }
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  Move-Item (Join-Path $installDir $pkg) $nodeDir
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
}
$env:PATH = "$nodeDir;$env:PATH"

# ---------- 3. Programa, dependencias, datos y accesos directos ----------
& (Join-Path $nodeDir 'node.exe') (Join-Path $src 'apps\desktop\launch\install.mjs')
if ($LASTEXITCODE -ne 0) { throw 'La instalación del programa ha fallado (mensajes de arriba).' }

$appDir = Join-Path $installDir 'app'
# Los ficheros descomprimidos de un ZIP bajado de internet llevan la marca "procede de internet":
# se quita para que Windows no pregunte cada vez que se abre la app.
Get-ChildItem -Path $appDir -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notlike '*\node_modules\*' } |
  Unblock-File -ErrorAction SilentlyContinue

# ---------- 4. Registro en "Aplicaciones instaladas" ----------
if (-not $env:WATCHLIST_NO_REGISTRY) {
  $version = (Get-Content (Join-Path $appDir 'package.json') -Raw | ConvertFrom-Json).version
  $sizeKb = [int]((Get-ChildItem $installDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum / 1KB)
  $uninstaller = Join-Path $appDir 'desinstalar.ps1'
  New-Item -Force $regKey | Out-Null
  Set-ItemProperty $regKey -Name InstallDir -Value $installDir
  New-Item -Force $uninstallKey | Out-Null
  $props = @{
    DisplayName     = 'Watchlist'
    DisplayIcon     = (Join-Path $appDir 'apps\desktop\assets\icon.ico')
    DisplayVersion  = $version
    Publisher       = 'RaclosDev'
    InstallLocation = $installDir
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`""
    URLInfoAbout    = 'https://github.com/RaclosDev/portfolio-tracker'
  }
  foreach ($k in $props.Keys) { Set-ItemProperty $uninstallKey -Name $k -Value $props[$k] }
  Set-ItemProperty $uninstallKey -Name NoModify -Value 1 -Type DWord
  Set-ItemProperty $uninstallKey -Name NoRepair -Value 1 -Type DWord
  Set-ItemProperty $uninstallKey -Name EstimatedSize -Value $sizeKb -Type DWord
  Write-Host ''
  Write-Host ' Registrada en Configuración > Aplicaciones instaladas (desde ahí se desinstala).'
}

Write-Host ''
Write-Host ' Listo. Abre "Watchlist" desde el escritorio o el menú Inicio.' -ForegroundColor Green
Write-Host " Esta carpeta descomprimida ya no hace falta: puedes borrarla."
