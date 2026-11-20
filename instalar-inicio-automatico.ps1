$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'JOSEPP - Servidor de turnos.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSScriptRoot 'INICIAR SERVIDOR.bat'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = 'Inicia el servidor local de turnos JOSEPP'
$shortcut.Save()
Write-Host "Inicio automático instalado para este usuario: $shortcutPath" -ForegroundColor Green
