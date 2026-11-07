# Crea el acceso directo "Watchlist" (escritorio y menu Inicio) que abre la app sin consola.
# Uso: lo llama instalar.bat. -Destinations permite indicar otras carpetas.
param([string[]]$Destinations)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$vbs = Join-Path $PSScriptRoot 'watchlist.vbs'
$ico = Join-Path $root 'apps\desktop\assets\icon.ico'

if (-not $Destinations) {
  $Destinations = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
}

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in $Destinations) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'Watchlist.lnk'))
  $lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
  $lnk.Arguments = '"' + $vbs + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$ico,0"
  $lnk.Description = 'Watchlist de acciones y ETF'
  $lnk.Save()
  Write-Host "  Acceso directo creado en: $dir"
}
