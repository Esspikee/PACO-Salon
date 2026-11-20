@echo off
chcp 65001 >nul
powershell.exe -NoProfile -Command "$p=Join-Path ([Environment]::GetFolderPath('Startup')) 'JOSEPP - Servidor de turnos.lnk'; if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p -Force; Write-Host 'Inicio automático eliminado.' -ForegroundColor Green}else{Write-Host 'No estaba instalado.'}"
pause
