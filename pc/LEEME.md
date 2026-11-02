# Despertar el PC a las 8:00 (opcional, Windows)

La extensión solo lee mientras el PC está encendido y Chrome abierto. Si apagas el PC por la noche, se pierden las lecturas de la mañana hasta que lo enciendes. Esto lo evita:

1. Activa la hibernación una vez, en una terminal de administrador (cada comando por separado):
   - `powercfg /h on`
   - `reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\FlyoutMenuSettings" /v ShowHibernateOption /t REG_DWORD /d 1 /f` (pone «Hibernar» en el menú de apagado)
2. Crea la tarea, sin ser administrador: `powershell -ExecutionPolicy Bypass -File pc\crear-tarea.ps1`
3. Cada noche, en vez de «Apagar», usa Inicio > Iniciar/apagar > «Hibernar», con Chrome abierto.

La tarea «Despertar PC ventas» despierta el PC a las 8:00 (nunca antes) y ejecuta `despertar.ps1`, que lo apunta en `despertar.log` y lo mantiene despierto 15 minutos. Desde las 8:00 la extensión impide que Windows lo vuelva a dormir hasta las 24:00.

Comprueba que en Opciones de energía > Configuración avanzada > Suspender > «Permitir temporizadores de reactivación» está en «Habilitar». Si tu placa base no despierta de la hibernación, busca en la BIOS la opción «RTC wake» (o «Resume by alarm») y ponla a las 8:00.
