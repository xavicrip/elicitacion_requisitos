# ADR 0010: Exportación con hojas de cálculo y Gherkin en `api` y reporte PDF en el worker de Python

- **Estado**: aceptado
- **Fecha**: 2026-10-03
- **Feature**: 008-exportacion-resultados (research R1–R8; plan, ajustes 1–19)

## Contexto

La 008 permite al Administrador llevarse el levantamiento fuera de la aplicación: los detalles
en CSV o Excel, los escenarios en Gherkin y un reporte PDF con los indicadores y hallazgos del
dashboard. La constitución exige que cada servicio sea dueño de sus colecciones (II), estados
consultables para los trabajos asíncronos (VI), seguridad por defecto (V) y un ADR para las
tecnologías nuevas. El plan original (anterior a la 002–007) preveía una colección compartida
con `analytics`, credenciales del bucket en el worker, matplotlib y un evento de socket.

## Decisión

1. **CSV, Excel y Gherkin en `api`**, en streaming sobre un cursor de MongoDB: `csv-stringify`
   (UTF-8 con BOM, `\r\n`, todo entrecomillado, delimitador `,` o `;`), `exceljs` con
   `WorkbookWriter` y `archiver` para el ZIP de `.feature`. Los `.feature` se validan en las
   pruebas con el parser oficial `@cucumber/gherkin` en español.
2. **Neutralización de fórmulas** (OWASP, CSV Injection): a todo texto que empiece por `=`, `+`,
   `-`, `@`, tabulador o retorno de carro se le antepone un apóstrofo; en Excel, además, las
   celdas de texto se escriben como cadena.
3. **Reporte PDF en `analytics-worker`** con WeasyPrint y Jinja2 (autoescape), gráficos de
   barras en SVG y el mapa de cobertura con Pillow. El worker no accede a MongoDB ni tiene
   credenciales del bucket: `api` escribe un archivo de entrada (instantánea descriptiva de la
   007, diagramas, detalles sin datos de personas y el último análisis) y le pasa una URL
   firmada de lectura y otra de escritura. `api` es la única que escribe `exports`.
4. **Sin servicio nuevo**: el proceso de `analytics-worker` consume las colas `detection` y
   `export`, con un latido por cola; su imagen añade las librerías de Pango.
5. **Síncrono hasta 1 000 detalles** (respuesta en streaming, sin guardar el archivo) y en
   segundo plano por encima o para cualquier PDF: cola `export-files` con un `Worker` dentro de
   `api` y cola `export` hacia Python. Estados `pending`, `running`, `done` y `failed`; una
   exportación en curso por proyecto y formato.
6. **Aviso por consulta periódica** (cada 3 s, como la 007) y **descarga a través de `api`**, que
   sirve el archivo desde el bucket con la sesión del Administrador y registra la descarga.
7. **Caducidad de 24 h**: `expiresAt` en el documento y una limpieza horaria con un
   `JobScheduler` de BullMQ; los archivos viven bajo el prefijo del proyecto, que la cascada de
   borrado elimina.
8. **Flag `exports`** hasta completar la feature y recorrerla en staging.

## Alternativas descartadas

- **Colección `exports` compartida y `boto3` en el worker** (plan original): reparte la escritura
  entre dos servicios y da al worker credenciales que no necesita.
- **Chromium o Playwright para imprimir el dashboard**: imagen de más de 1 GB y resultado frágil.
- **`@react-pdf/renderer` en Node**: habría que rehacer los gráficos y la maquetación.
- **matplotlib** para los gráficos del reporte: dependencia pesada para unas barras.
- **Un servicio aparte para el PDF**: otro despliegue que mantener para un trabajo ocasional.
- **URL firmada del bucket para descargar**: el bucket no es accesible desde el navegador en
  Compose y la descarga quedaría fuera de la sesión y de la auditoría.
- **Evento de socket `export:ready`**: las salas de la 005 son por diagrama.
- **Regla de ciclo de vida del bucket**: depende del proveedor; la limpieza horaria basta.
