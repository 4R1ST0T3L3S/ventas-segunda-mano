# Crea (o rehace) la tarea «Despertar PC ventas», que ejecuta despertar.ps1 cada día a las 8:00 y despierta el PC para
# ello. Solo despierta un PC hibernado, no uno apagado. Nunca antes de las 8:00: de noche el PC tiene que estar en
# silencio. No hace falta ser administrador.
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSScriptRoot\despertar.ps1`""
$cuando = New-ScheduledTaskTrigger -Daily -At '08:00'
$ajustes = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName 'Despertar PC ventas' -Action $accion -Trigger $cuando -Settings $ajustes -Force `
  -Description 'Despierta el PC a las 8:00 para que la extensión Lector de ventas lea desde esa hora (carpeta pc del proyecto).'
