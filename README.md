# JOSEPP · Turnos y tickets del salón

Documentación técnica del estado actual del proyecto, actualizada el **14/11/2026**. Está escrita para quien continúe el desarrollo, incluida otra IA. La guía rápida de instalación está en `LEEME - INSTALACION.md`; este README describe además la arquitectura y las decisiones funcionales que se han incorporado.

## Qué hace el sistema

Un PC Windows ejecuta un servidor HTTP local en el puerto **8080**. Las vistas HTML usan ese servidor y comparten el tablero de turnos, el equipo, los tickets y la configuración:

| Ruta | Uso |
| --- | --- |
| `/main` | Vista principal; permite trabajar con ambas especialidades. |
| `/auxiliar` | Vista auxiliar; permite trabajar con ambas especialidades. |
| `/manicuristas` | Vista de manicuristas; al **crear** servicios de un ticket muestra los de esa especialidad y `PRODUCTO`. |
| `/estilistas` | Vista de estilistas; al **crear** servicios de un ticket muestra los de esa especialidad y `PRODUCTO`. |
| `/juan-pablo` | Vista personal de teléfono para Juan Pablo. Muestra Tickets e Historial con navegación inferior y vincula el trabajo a su registro de empleado. Al dejar un ticket abierto, permite elegir a cualquier trabajador responsable. |

**El historial de tickets, tanto abiertos como finalizados, se ve en las cuatro vistas generales.** El filtro por especialidad afecta a la selección de trabajador y servicios al registrar un ticket, no a su historial. La vista de Juan Pablo solo presenta tickets en los que trabajó o que quedaron abiertos a su nombre. Esta vista personaliza la interfaz; la URL no es un mecanismo de autenticación.

El sistema está pensado para la red local del salón. Las tablets y el PC deben estar en la misma red. El servicio escucha en `0.0.0.0` por defecto; la regla de firewall suministrada limita el acceso al puerto 8080 a la subred privada local. **No hay autenticación ni HTTPS:** no publicar el puerto en Internet.

## Estructura de archivos

| Archivo o carpeta | Responsabilidad |
| --- | --- |
| `server.mjs` | Servidor HTTP, rutas, validación, estado compartido, persistencia y eventos del tablero y tickets. |
| `ticket-storage.js` | Adaptador de almacenamiento de tickets y ajustes. Presenta una interfaz similar a `localStorage`, pero lee y escribe `/ticket-state`. |
| `htmls/main.html` | Vista principal. |
| `htmls/auxiliar.html` | Vista auxiliar. |
| `htmls/manicuristas.html` | Vista especializada de manicuristas. |
| `htmls/estilistas.html` | Vista especializada de estilistas. |
| `htmls/juan-pablo-2.0.html` | Vista de teléfono de Juan Pablo, vinculada al ID `e69d26e7-d3d7-440e-9117-c71e264a1d70`. |
| `htmls/william.html` | Vista de teléfono de William, vinculada al ID `63421b4b-e733-4199-b45e-b7f0e24a3dbc`. |
| `htmls/josepp-watermark.png` | Versión ligera del logo usada como marca de agua detrás de los nombres de empleados. |
| `data/tablero.json` | Estado real del tablero y del equipo. **Datos de producción.** |
| `data/tickets.json` | Líneas de tickets, consecutivo y ajustes compartidos. **Datos de producción.** |
| `backups/` | Copias automáticas del tablero, tickets, ajustes y código del proyecto. **Datos de producción; no se sube a Git.** |
| `initial-team.json` | Semilla del equipo, usada solo si no existe `data/tablero.json`. |
| `runtime/node.exe` | Node.js portátil incluido para Windows. |
| `INICIAR SERVIDOR.bat` | Busca Node.js, inicia el servidor y abre `/main`. |
| `CONFIGURAR FIREWALL (UNA VEZ).bat`, `configurar-firewall.ps1` | Regla de entrada TCP 8080 para perfil privado y subred local. |
| `INSTALAR INICIO AUTOMATICO.bat`, `instalar-inicio-automatico.ps1`, `QUITAR INICIO AUTOMATICO.bat` | Acceso directo de inicio automático de Windows. |
| `test/server.test.mjs` | Pruebas de rutas, sincronización, persistencia y reglas principales de Tickets. |

Los HTML contienen una aplicación compilada y minificada, además de un bloque grande de CSS y JavaScript para Tickets. Son archivos de alrededor de 2 MB. Buena parte del código de Tickets está **duplicada en las vistas generales y la vista personal**; un cambio funcional común debe aplicarse y verificarse en todas las vistas afectadas.

Esta carpeta no contiene un repositorio `.git` en el estado revisado. El código actual y este README son la referencia disponible para reconstruir las decisiones recientes.

## Instalación y ejecución

1. Conservar toda la carpeta junta. No abrir `htmls/*.html` como `file://`; la sincronización requiere el servidor.
2. En Windows, ejecutar una vez `CONFIGURAR FIREWALL (UNA VEZ).bat` con autorización de administrador y comprobar que el Wi-Fi esté marcado como red **Privada**.
3. Ejecutar `INICIAR SERVIDOR.bat`. El BAT busca `node.exe` en `PATH`, ubicaciones comunes de Windows y `runtime/node.exe`.
4. Dejar abierta la ventana de comandos del servidor. Para detenerlo, usar `Ctrl+C` en esa ventana.

También se puede iniciar desde PowerShell en esta carpeta:

```powershell
.\runtime\node.exe server.mjs
```

`package.json` requiere Node.js **18 o superior** y ofrece `npm start` y `npm test`. No hay dependencias de npm declaradas. El runtime portátil incluido se comprobó como Node.js 24.22.1 al redactar este documento.

Variables opcionales: `HOST` (por defecto `0.0.0.0`), `PORT` (por defecto `8080`) y `SALON_DATA_DIR` (por defecto `data` dentro del proyecto). El BAT y la regla de firewall están preparados para el puerto 8080; si se cambia, hay que adaptar esas piezas.

### Direcciones

En el PC: `http://localhost:8080/main`.

En las tablets, reemplazar `<IP_DEL_PC>` por la IPv4 que imprime el servidor:

```text
http://<IP_DEL_PC>:8080/main
http://<IP_DEL_PC>:8080/auxiliar
http://<IP_DEL_PC>:8080/manicuristas
http://<IP_DEL_PC>:8080/estilistas
http://<IP_DEL_PC>:8080/juan-pablo
```

Una **reserva DHCP** para el PC en el router evita que estos favoritos cambien cuando el router se reinicia. `GET /health` permite comprobar que el servidor responde.

## Arquitectura de datos y sincronización

### Tablero y equipo

`server.mjs` carga `data/tablero.json` al iniciar. Si no existe, crea el estado a partir de `initial-team.json`. El estado contiene `format`, `schema`, `version` y `workers`. Cada trabajador tiene identificador, nombre, especialidad (`MANICURISTA`, `ESTILISTA` o `AUXILIAR`), indicador `active` y, opcionalmente, horario y deshabilitación por el día. Un auxiliar siempre se guarda con `active: false` para que no entre en la fila del Tablero.

- `GET /board` entrega el estado y la disponibilidad de **Deshacer**.
- `POST /actions` aplica cambios de equipo y fila: `save`, `delete`, `disable`, `enable`, `reorder`, `rotate`, `undo` e `import`.
- Las acciones envían la `version` leída; una versión obsoleta devuelve HTTP **409**. `operation_id` permite deduplicar una acción repetida.
- `GET /events` mantiene una conexión SSE para anunciar cambios del tablero. El servidor envía un ping cada 20 segundos.
- `GET /backup` exporta **solo el tablero/equipo**, no los tickets.
- El historial de Deshacer está en memoria: reiniciar el servidor conserva los datos guardados, pero vacía ese historial.

El servidor escribe el JSON mediante archivo temporal y renombrado (con alternativa para errores de permisos de Windows). Las mutaciones se procesan en secuencia.

### Respaldos automáticos

Al iniciar, el servidor crea una copia inmediata. Mientras siga abierto, crea otra cada **30 minutos** en `backups/<fecha UTC>-<identificador>/`. Cada carpeta contiene `tablero.json` (equipo y fila), `tickets.json` (tickets, consecutivo, servicios, precios y demás ajustes), `manifest.json` y `source.tar.gz` (HTML, servidor, scripts y documentación). No se incluyen `.git` ni `runtime`, que son componentes estáticos. Las copias se conservan sin borrado automático, así que conviene vigilar el espacio disponible.

Además, antes de reemplazar cada archivo JSON activo, el servidor conserva la versión anterior en `data/tablero.json.bak` o `data/tickets.json.bak`. Si un archivo activo se daña, el servidor intenta cargar esa copia y lo anuncia en la consola. Para restaurar una copia fechada: detener el servidor, copiar `tablero.json` y `tickets.json` de la misma carpeta de respaldo a `data/`, y volver a iniciarlo. Conservar antes los archivos que se van a reemplazar.

### Tickets y ajustes

`data/tickets.json` contiene `tickets` (líneas), `nextTicketNumber` y `settings`. Las líneas del mismo ticket comparten `ticketGroupId` y `ticketNumber`. El servidor asigna el consecutivo del grupo y conserva campos adicionales como `productName`, `supplies`, `paymentMethod`, `enteredAt` y `ticketStatus`. El valor `amount` debe ser un entero entre 0 y 10.000.000 COP.

- `GET /ticket-state` entrega tickets, consecutivo y ajustes.
- `POST /ticket-state` acepta `action: "changes"` o `"migrate"`, `upsert`, `deleteIds` y `settings`. Las escrituras también se serializan.
- Si dos tablets escriben sobre el mismo ticket casi a la vez, el servidor aplica el último cambio de estado y responsable a **todas** las líneas del grupo. Esto evita que un mismo ticket quede parcialmente abierto y parcialmente finalizado.
- `GET /ticket-storage.js` entrega el adaptador sin caché.
- Al servir una vista HTML, `server.mjs` **inyecta** `ticket-storage.js` en el marcador exacto `/* Tickets locales compartidos por las cuatro pantallas HTML. */`. La vista personal conserva el mismo marcador. **No eliminar ni cambiar ese marcador sin adaptar el servidor.**
- `ticket-storage.js` importa una vez los datos antiguos del navegador, calcula cambios de tickets por ID y envía solo altas, modificaciones y eliminaciones. El servidor avisa por SSE cuando cambia un ticket; cada tablet consulta `/ticket-state` al recibir el aviso y al volver a primer plano. También consulta cada **2 segundos** como respaldo y emite `salon-tickets-updated`.

El JavaScript de Tickets usa la variable llamada `localStorage`, pero en esa sección se asigna a `window.salonTicketStorage`. Por eso los tickets y ajustes aceptados por el adaptador terminan en el **servidor**, no quedan como fuente principal en el almacenamiento del navegador. El navegador sí mantiene una marca de migración y puede contener datos históricos previos.

Las claves de ajustes sincronizadas incluyen:

| Clave | Contenido |
| --- | --- |
| `salon-service-prices-v1` | Precios base de servicios. |
| `salon-custom-services-v1` | Servicios añadidos por el usuario. |
| `salon-deleted-services-v1` | Servicios base ocultados. `PRODUCTO` se conserva siempre. |
| `salon-color-supplies-v1` | Catálogo de insumos. |
| `salon-service-specialties-v1` | Roles habilitados para cada servicio y metadatos descritos abajo. Cada servicio guarda una lista de roles (`MANICURISTA`, `ESTILISTA`, `AUXILIAR`); los valores antiguos de una especialidad siguen siendo compatibles. |

Dentro de `salon-service-specialties-v1` también se guardan `__requiresSupplies` (si cada servicio pide insumos), `__serviceOrder` (orden de servicios), `__workerOrder` (orden de empleados dentro de Tickets) y `__boardIdleSeconds` (tiempo antes de volver a Tablero). El adaptador expone además `salon-service-requires-supplies-v1` como alias respaldado por `__requiresSupplies`. **Preservar estas propiedades** al editar los ajustes; no reemplazar todo el objeto con un mapa que solo contenga especialidades.

**Copia de seguridad completa:** conservar juntos `data/tablero.json` y `data/tickets.json`. La función de exportación del equipo y `GET /backup` no sustituyen una copia de `tickets.json`. No modificar los JSON a mano mientras el servidor esté activo.

## Reglas funcionales de Tickets

- En `main` y `auxiliar`, el botón «Historial de ticket» aparece entre las dos tarjetas de disponibles y abre directamente el historial. En `manicuristas` y `estilistas`, el botón «ticket» queda debajo del nombre disponible y abre Tickets. Desde otras secciones, cada botón conserva su destino y flota al centro de la parte inferior; se oculta mientras hay un menú lateral o una confirmación modal abierta.
- Si una vista distinta de Tablero permanece sin interacción, vuelve a Tablero después de **30 segundos** por defecto. En Menú → Apariencia → «Volver al tablero tras inactividad» se puede elegir 15, 30, 45, 60, 120 o 300 segundos. La selección se guarda en el servidor y se comparte entre las cuatro tablets.

### Equipo, servicios y precios

- Los trabajadores visibles en “Quién atendió” provienen de `/board`. `main` y `auxiliar` muestran las tres especialidades; `estilistas` muestra estilistas y auxiliares, y `manicuristas` muestra manicuristas. Los auxiliares aparecen en Tickets aunque no figuren en el Tablero.
- En “Servicios y precios”, cada servicio tiene casillas para **Manicuristas**, **Estilistas** y **Auxiliar**. Se puede marcar más de una, pero al menos una es obligatoria. Al crear un ticket se muestran los servicios asignados al rol del trabajador seleccionado. Para conservar la configuración previa, los servicios guardados como Estilistas también se muestran a Auxiliar hasta que se editen sus casillas. Las cuatro tablets pueden consultar **todos** los tickets ya creados.
- Mantener presionado y arrastrar un servicio cambia su orden en Tickets. Lo mismo funciona con empleados en “Quién atendió”, dentro de la especialidad. Ambos órdenes se sincronizan mediante los ajustes del servidor. El orden de empleados de Tickets es **independiente** de la fila del Tablero.
- En el Tablero, mantener presionada cualquier parte de la tarjeta durante 350 ms inicia el arrastre. Deslizarla hasta otra posición de la misma columna y soltar guarda el nuevo orden; la tarjeta de destino muestra una línea de inserción. Un toque corto envía a la persona al final. Ya no hay icono de seis puntos ni aviso de deshabilitación por pulsación larga. Si el tablero cambió en otra tablet justo antes de guardar, se reintenta una vez.
- El logo JOSEPP aparece con baja opacidad detrás de las tarjetas de disponibles, la fila, los nombres en «Quién atendió», el selector de responsable y las filas de «Equipo y ajustes». La imagen se sirve desde `/josepp-watermark.png`; los cuatro HTML permiten imágenes del propio servidor en su CSP.
- En “Equipo y ajustes”, manicuristas y estilistas tienen una casilla **En tablero**. Desmarcarla los oculta únicamente del Tablero; siguen disponibles en “Quién atendió” y al asignar tickets abiertos. Marcarla los vuelve a incluir en el Tablero según su horario y quita una deshabilitación anterior por el día. Los auxiliares tienen una sección propia, aparecen solo en Tickets y no necesitan horario ni casilla de Tablero. Los cambios se guardan en el servidor y se sincronizan en las tablets.
- El toque corto sobre un servicio lo **añade inmediatamente** como línea pendiente del ticket. Si tiene precio fijo, se usa ese valor y la línea conserva “Editar” y “Eliminar”. Si no tiene precio fijo, aparece directamente una caja numérica de **Precio** junto a “Eliminar”; se debe introducir el precio antes de guardar el ticket.
- Los campos monetarios de Tickets y Servicios y precios muestran puntos de miles mientras se escribe (por ejemplo, `50000` se ve como `50.000`). Al guardar, se quitan los puntos y se conserva un número entero; los totales y los datos del servidor siguen siendo numéricos.
- Los servicios pueden marcarse como “Requiere insumos”. Al seleccionarlos se añade la línea al ticket y, en **Valor**, aparece cada insumo con una caja numérica para indicar la cantidad usada (0–999). `COLOR` requiere insumos por defecto, salvo configuración explícita. Las cantidades quedan guardadas en la línea del ticket; al editar una línea ya guardada sigue disponible el selector de insumos.
- `PRODUCTO` es un servicio **permanente**, disponible con los tres roles, sin precio base ni opción de borrarlo desde “Servicios y precios”. En “Valor” se escriben el nombre y el precio directamente. La línea muestra solamente el icono de eliminar, no “Editar”; el total cambia al introducir el precio. Antes de guardar se exige nombre y precio escritos. En el historial sigue existiendo la edición del servicio.

### Ciclo de vida e historial

- El usuario introduce cliente, trabajador y servicios. Puede **dejar el ticket abierto** o **finalizarlo**. Al retomar un ticket desde “Tickets abiertos”, la vista sube al formulario y preselecciona al trabajador responsable si pertenece a la tablet; si no, usa al último trabajador del ticket disponible en esa vista. Esto evita que Servicios quede vacío cuando un auxiliar entrega el ticket a una manicurista. Allí se pueden añadir más servicios y volver a guardarlo abierto o finalizarlo.
- Al pulsar **Nuevo ticket**, un diálogo pide el nombre del cliente. Si alguien intenta añadir el primer servicio sin nombre, aparece el mismo diálogo y el servicio se añade después de confirmar. Cancelar no guarda ni añade el servicio. Esto funciona en las cuatro vistas generales y la vista de Juan Pablo; no interrumpe la edición de un ticket abierto.
- Al pulsar **Dejar ticket abierto**, la tablet espera la confirmación del servidor. Tras guardarlo, el ticket aparece en la lista compartida de abiertos y el formulario vuelve a un ticket nuevo: se limpian cliente, líneas de servicio y valores, pero se conserva el trabajador seleccionado para que el catálogo de servicios permanezca visible. Si falla el guardado, se conserva el formulario para reintentar y se muestra el error. Esto también ocurre al volver a guardar un ticket abierto que se retomó para añadir servicios.
- Antes de dejarlo abierto aparece un diálogo para elegir **a quién queda asignado**. Presenta estilistas a la izquierda y manicuristas a la derecha en las cuatro tablets, y exige seleccionar una persona. El nombre se muestra encima del mini recibo abierto y se guarda en el servidor junto con cada línea; al volver a guardar el ticket se puede cambiar la asignación **sin añadir otro servicio**. Los tickets abiertos creados antes de esta función muestran «Sin asignar» hasta que se guarden de nuevo.
- Los tickets abiertos y finalizados se presentan como mini recibos horizontales de aproximadamente 286 px, con desplazamiento lateral. Su tipografía se amplió un nivel sin cambiar la del formulario ni otras secciones. Cada uno muestra nombre del cliente como título, consecutivo, servicios, total y fecha corta **DD/MM**.
- En la vista **main**, “Historial de tickets” tiene dos secciones: **Tickets abiertos** y **Tickets finalizados**. Todos los finalizados aparecen juntos, independientemente de si están marcados como “Ingresado”. Las secciones se pueden expandir o contraer; los abiertos también siguen visibles en la vista de Tickets.
- Tocar un ticket finalizado abre una confirmación para **reabrirlo**. Una pulsación larga sobre un ticket permite confirmar su eliminación; el gesto se cancela si se está desplazando.
- “Ingresado” se marca en tickets finalizados mediante su confirmación. La forma de pago se selecciona en cada recibo del historial: **💵 efectivo, 💳 tarjeta de crédito, 🏦 transferencia**; las opciones conservan etiquetas accesibles.
- El nombre del cliente y los importes aceptan Enter para perder el foco y ocultar el teclado en las tablets. Los importes muestran teclado numérico. Las entradas enfocadas no se desmontan por una actualización de fondo, para evitar que el teclado desaparezca.
- Deslizar sobre la lista de servicios usa scroll táctil nativo. Un movimiento corto cancela la pulsación larga y evita añadir el servicio por accidente; mantener presionado sigue permitiendo reordenarlo.

### Navegación y actividad

- Los controles superiores incluyen **Tablero**, **Tickets** e **Historial**. Historial es una vista separada y contiene únicamente tickets finalizados, divididos entre no ingresados e ingresados.
- Los botones flotantes de los bordes muestran **Menú** a la izquierda y el icono de **Deshacer** a la derecha, con el mismo tamaño y altura en todas las vistas. Deshacer ejecuta la acción del tablero y aparece deshabilitado cuando no hay una acción reversible.
- En **Tickets**, la zona que antes mostraba el historial contiene únicamente **Tickets abiertos**. Cada ticket abierto puede retomarse desde allí; “Dejar ticket abierto” permanece junto a “Finalizar”.
- Al pasar de Servicios y precios a Tickets, la vista de precios permanece visible hasta que Tickets ya está preparado. En el sentido contrario se cierra Tickets antes de abrir Precios, para evitar mostrar la tarjeta del cliente sobre la nueva vista.
- Tickets, Historial, Servicios y precios y Equipo y ajustes regresan automáticamente a Tablero tras el tiempo elegido en Apariencia (**30 segundos** por defecto). Tocar, escribir o desplazarse reinicia el tiempo. Tablero no tiene ese temporizador.

## API resumida

| Método y ruta | Uso |
| --- | --- |
| `GET /health` | Salud del servidor, versión del tablero y número de conexiones SSE. |
| `GET /board` | Equipo y orden del tablero. |
| `POST /actions` | Acciones del tablero con control de versión. |
| `GET /events` | Eventos SSE del tablero. |
| `GET /backup` | Copia del tablero/equipo. |
| `GET /ticket-state` | Tickets y ajustes compartidos. |
| `POST /ticket-state` | Cambios o migración de tickets y ajustes. |
| `GET /ticket-storage.js` | Adaptador de sincronización del navegador. |
| `GET /josepp-watermark.png` | Logo ligero para las marcas de agua. |
| `GET /`, `/main`, `/auxiliar`, `/manicuristas`, `/estilistas` | Vistas HTML. |

El servidor lee los HTML y `ticket-storage.js` del disco en cada solicitud y envía encabezados sin caché. Por eso una edición de esos archivos se ve tras **recargar** la tablet. Un cambio en `server.mjs` requiere **reiniciar el proceso Node**.

## Cómo continuar el desarrollo

1. Revisar este README, `server.mjs`, `ticket-storage.js` y `test/server.test.mjs` antes de editar. La guía `LEEME - INSTALACION.md` está enfocada en instalación.
2. Localizar la lógica de Tickets en los cuatro HTML por nombres de funciones o selectores (`openTickets`, `openPrices`, `renderTickets`, `getAllServices`, `getWorkers`). Evitar imprimir completas las líneas minificadas de 2 MB.
3. Si el cambio es común, aplicarlo a **los cuatro HTML**. Las diferencias de las dos vistas especializadas deben conservarse.
4. Mantener la inyección de `ticket-storage.js` y las claves de ajustes. No volver a usar `window.localStorage` como fuente principal de tickets.
5. No sobrescribir ni borrar `data/tablero.json` o `data/tickets.json` al probar. Las pruebas automatizadas crean directorios temporales separados.
6. Verificar sintaxis de los scripts incrustados y ejecutar la suite:

```powershell
.\runtime\node.exe --test test\server.test.mjs
```

Al escribir este README, la suite contiene **34 pruebas** y todas pasaron. Cubre las rutas generales y la vista personal de Juan Pablo, sincronización y persistencia, cambios concurrentes de tickets, casillas de visibilidad, orden de empleados y servicios, pulsación larga y arrastre de tarjetas del Tablero, reintento de conflictos del tablero, `PRODUCTO`, navegación, scroll táctil y retorno por inactividad. Una comprobación adicional útil es abrir `/health` y las rutas con el servidor en marcha; para cambios visuales conviene probar físicamente en teléfono y tablet además de la suite.

## Diagnóstico rápido

- **Pantalla blanca:** abrir la ruta HTTP del servidor, no el HTML directamente; comprobar `/health` y la consola del navegador.
- **Solo funciona el PC:** comprobar IP del PC, Wi-Fi compartido, red privada y regla del puerto 8080.
- **Cambió la IP:** consultar las URL que imprime el servidor y configurar una reserva DHCP.
- **Tickets desincronizados:** comprobar `/ticket-state`, la conexión de las tablets y `ticket-storage.js`. Las actualizaciones de tickets usan SSE, consulta al reactivar la tablet y una consulta de respaldo cada 2 segundos.
- **Puerto ocupado o servidor “cerrado” pero aún responde:** verificar qué proceso Node usa el puerto 8080 antes de lanzar otra instancia.
- **Un HTML muestra una conducta distinta:** comparar el bloque de Tickets y los estilos de las cuatro vistas; un cambio puede haber quedado aplicado solo en algunas.
