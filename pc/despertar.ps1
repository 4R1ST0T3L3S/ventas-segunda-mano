# Lo ejecuta la tarea «Despertar PC ventas» del Programador de tareas (crear-tarea.ps1): cada día a las 8:00, con
# «Activar el equipo para ejecutar esta tarea», despierta el PC de la hibernación para que la extensión «Lector de
# ventas» lea Vinted y Wallapop desde las 8:00. Windows vuelve a dormir a los pocos minutos un PC que se ha despertado
# solo: esto lo mantiene despierto 15 minutos, tiempo de sobra para que la extensión pida lo mismo hasta las 24:00.
# Cada vez lo apunta en despertar.log.
Add-Type -Namespace Win32 -Name Energia -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint estado);'
Add-Content -Path "$PSScriptRoot\despertar.log" -Value ('{0:yyyy-MM-dd HH:mm:ss} despierto' -f (Get-Date))
[Win32.Energia]::SetThreadExecutionState(0x80000001) | Out-Null  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED, hasta que acabe
Start-Sleep -Seconds 900
