# Verificación de la aplicación MediPoli en AWS dev

El 21 de noviembre de 2026, hora de Bogotá, se verificó el flujo funcional de U3 en `us-east-2`. La comprobación completa corresponde a la revisión `ea57935` y al alias activo de la API en versión 3. El dominio HTTPS de CloudFront es propio del ambiente de desarrollo. [Portal de MediPoli](https://dv41a4jtx3h0h.cloudfront.net/MediPoli/) · [Diagrama de arquitectura](../diagramas/u3/01-arquitectura.mmd)

## Despliegue

Terraform añadió 39 recursos de aplicación con cero cambios y cero eliminaciones en el plan revisado. Se reutilizaron la tabla de agenda y la infraestructura base de U2, además del flujo de auditoría de MP-09. Un segundo plan comprobó la coincidencia entre la configuración y el estado desplegado. La aplicación utiliza CloudFront, S3 privado, Cognito, API Gateway HTTP, Lambda y DynamoDB. [Evidencia MP-09](../specs/001-auditoria-citas/tasks.md) · [Configuración de Terraform](../infra/ambiente)

La preparación en `dev` usa `enable_application=true` en el estado remoto `dev/base.tfstate`. El origen público de desarrollo se deriva de CloudFront. Para el ensayo MCP se registró `http://localhost:6274/oauth/callback` como destino exacto. La salida `application` de Terraform proporciona los datos necesarios para compilar el sitio, conectar Cognito y publicar. Se ejecuta el release con `RELEASE_MODE=directo-dev` y el perfil temporal de MediPoli. [Script de publicación](../scripts/publicar.mjs) · [Configuración de identidad](../infra/ambiente/identidad.tf)

La carga creó 60 pacientes ficticios, 15 profesionales y una cuenta administrativa. Incluye franjas de medicina general y odontología en tres sedes. El script de carga omite el envío de credenciales por correo. Los archivos de acceso permanecen en el área privada de la ejecución. [Script de carga](../scripts/cargar-datos.mjs) · [Catálogo de prueba](../src/shared/catalogo.mjs)

## Pruebas observadas en desarrollo

| Ensayo | Resultado |
| --- | --- |
| HTTPS y estado del servicio | El portal y la ruta de estado devolvieron HTTP 200. La consulta de perfil sin un token devolvió 401. |
| Inicio de sesión | Se autenticaron dos pacientes, un profesional y un administrador mediante Cognito. |
| Reserva y duplicados | El reintento con la misma clave devolvió la misma cita. El segundo paciente recibió 409 al intentar ocupar la franja ya reservada. |
| Titularidad y roles | Una cancelación ajena obtuvo 404 y un paciente recibió 403 al solicitar el reporte administrativo. El profesional vio la cita que le correspondía y el administrador consultó las cantidades. |
| Cambios de cita | La reprogramación produjo la revisión 2 y la cancelación produjo la revisión 3. La tabla de auditoría conservó una fila por cada revisión con el mismo ID de solicitud de la API. |
| MCP | La petición sin autorización recibió 401. Un token con audiencia exacta permitió consultar disponibilidad. La herramienta exigió confirmación para reservar y la cita confirmada se consultó desde la web. |

La prueba MCP utilizó un cliente técnico con autorización de código y PKCE. Las operaciones de prueba concluyeron con las citas canceladas. La prueba del fallo persistente y el reproceso del evento archivado se documentaron por separado en MP-09. [Pruebas locales de integración](../pruebas/integracion.test.mjs) · [Ensayo de recuperación](../specs/001-auditoria-citas/quickstart.md)

## Señales de operación

La muestra autenticada de `disponibilidad` tuvo 12 respuestas correctas de 12. El p50 medido desde el cliente fue 220 ms y el p95 fue 305 ms por rango más cercano. La muestra sirve como referencia del ensayo en ese ambiente. Para separar el arranque en frío del tiempo de red, los registros REPORT de Lambda aportaron dos tiempos de inicialización de 491,52 ms y 481,91 ms dentro de la ventana consultada.

Una reserva se encontró en los registros de API Gateway, Lambda de API y Lambda de auditoría mediante el mismo ID de solicitud. Se verificaron el tablero `medipoli-dev` y sus alarmas de latencia, errores 5xx y atraso de Streams. La etapa de API configura un ritmo de 8 solicitudes/s y una ráfaga de 20. Los objetivos iniciales que se deben observar son la proporción de respuestas correctas, el p95 y la demora de propagación hacia el consumidor. [Alarmas y tablero](../infra/ambiente/observabilidad.tf) · [Flujo de observación](../diagramas/u3/07-observabilidad.mmd)

Los manifiestos del ensayo, las capturas y la correlación quedan bajo `evidencia/privada/`. Las pruebas controladas de autorización emplearon exclusivamente cuentas ficticias.
