# JOSEPP — servidor local de turnos

Esta carpeta contiene el servidor y cuatro pantallas conectadas: principal, auxiliar, manicuristas y estilistas. El PC guarda el estado y las tablets lo comparten por la red Wi‑Fi del salón. No necesita internet después de la instalación. La arquitectura y los cambios actuales están documentados en `README.md`.

## Primera instalación en el PC servidor

1. Mantén esta carpeta en un lugar fijo del PC. No ejecutes solamente los HTML: ahora deben abrirse a través del servidor.
2. Ejecuta **CONFIGURAR FIREWALL (UNA VEZ).bat**. Windows pedirá permiso de administrador. La regla permite el puerto 8080 únicamente desde la red privada local.
3. Comprueba que Windows identifica el Wi‑Fi del salón como una red **Privada**, no Pública.
4. Ejecuta **INICIAR SERVIDOR.bat**. Se abrirá el panel principal en el navegador y la ventana negra mostrará las direcciones para las tablets.
5. Mantén abierta la ventana del servidor durante la jornada. El PC no debe entrar en suspensión.

La carpeta incluye un runtime portátil de Node.js en `runtime/node.exe`, por lo que no depende de la instalación ni del `PATH` de Windows. Si el PC también tiene una instalación normal de Node.js, el archivo de inicio puede utilizarla automáticamente.

## Direcciones

En el PC:

- Panel principal: `http://localhost:8080/main`

En las tablets utiliza la dirección IP que aparece en la ventana del servidor, por ejemplo:

- Manicuristas: `http://192.168.1.50:8080/manicuristas`
- Estilistas: `http://192.168.1.50:8080/estilistas`
- Principal: `http://192.168.1.50:8080/main`
- Auxiliar: `http://192.168.1.50:8080/auxiliar`

Guarda cada dirección como favorito o acceso directo en la tablet. El PC y ambas tablets deben permanecer conectados al mismo Wi‑Fi. Conviene reservar la dirección IP del PC en el router para que los favoritos no cambien; la opción suele llamarse **reserva DHCP** o **dirección fija**.

## Inicio automático

Ejecuta **INSTALAR INICIO AUTOMATICO.bat** si quieres que el servidor se abra al iniciar sesión en Windows. **QUITAR INICIO AUTOMATICO.bat** elimina ese comportamiento.

## Pasar los datos de la versión anterior

Los datos almacenados por el HTML anterior no se copian solos al servidor:

1. Abre el HTML anterior en el mismo navegador donde se utilizaba.
2. En **Equipo y ajustes**, pulsa **Exportar copia**.
3. Inicia este servidor y abre `http://localhost:8080/main`.
4. En **Equipo y ajustes**, pulsa **Importar copia** y selecciona `salon-copia.json`.

Haz esta importación una sola vez. Desde ese momento los cambios se guardan centralmente.

## Datos y copias de seguridad

El equipo y el tablero se guardan en `data/tablero.json`; los tickets y sus ajustes se guardan en `data/tickets.json`. Ambos archivos se crean automáticamente. No los edites mientras el servidor esté abierto. **Exportar copia** desde Equipo y ajustes cubre el tablero/equipo; para una copia completa conserva también `data/tickets.json`.

En las filas, un toque corto sobre una tarjeta envía a la persona al final. Una pulsación larga sobre el nombre abre la opción de deshabilitarla por el día. Para colocarla en una posición específica, mantén presionados los seis puntos situados a la derecha y arrastra la tarjeta.

La función **Deshacer** revierte la última acción compartida mientras el servidor permanezca abierto. Reiniciar el servidor conserva el equipo y el orden, pero vacía la lista temporal de acciones para deshacer.

## Diagnóstico rápido

- Si el PC abre el panel pero las tablets no: revisa el firewall, que la red sea Privada y que todos estén en el mismo Wi‑Fi.
- Si ninguna pantalla abre: comprueba que **INICIAR SERVIDOR.bat** siga abierto y que el puerto 8080 no esté ocupado.
- Si la dirección de las tablets dejó de funcionar después de reiniciar el router: revisa la nueva IP impresa por el servidor y configura una reserva DHCP.
- Estado técnico: `http://localhost:8080/health` debe mostrar `"ok": true`.

## Archivos principales

- `server.mjs`: servidor HTTP, sincronización y persistencia.
- `htmls/main.html`: panel general.
- `htmls/auxiliar.html`: vista auxiliar.
- `htmls/manicuristas.html`: vista de manicuristas.
- `htmls/estilistas.html`: vista de estilistas.
- `ticket-storage.js`: sincronización de tickets y ajustes con el servidor.
- `initial-team.json`: equipo usado solamente durante el primer inicio si aún no existe `data/tablero.json`.
