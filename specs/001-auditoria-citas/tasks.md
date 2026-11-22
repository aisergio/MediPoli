# MP-09 · Tareas y trazabilidad

Unidad 3 · Corte del 21 de noviembre de 2026, hora de Bogotá. Cada casilla se cierra con la comprobación de la fila.

- [x] T01 · Enlazar MP-09 y P-09 con cinco criterios en la [especificación](spec.md) y definir su alcance con la [constitución](../../.specify/memory/constitution.md).
- [x] T02 · Contrastar el [diseño existente](plan.md) y el formato del objeto de fallos con el ejemplo de AWS.
- [x] T03 · CA-01, CA-02 y CA-05. Tres revisiones fuera de orden conservaron el historial mínimo. La repetición mantuvo el identificador de solicitud original y el diagnóstico excluyó los marcadores de datos privados.
- [x] T04 · CA-03. Un fallo de escritura devolvió la secuencia pendiente. Al repetir el lote, la entrada ya guardada conservó su contenido y se recuperó la pendiente.
- [x] T05 · CA-04. Se reprodujo el rechazo de la clave sin extensión. El comando corregido leyó el objeto de prueba con el formato publicado por AWS, conservó la compatibilidad anterior y rechazó resultados parciales o ilegibles.
- [x] T06 · Ejecutar las validaciones locales y asociar los resultados a la revisión.
- [x] T07 · Verificar en AWS dev el flujo del mapeo, el historial mínimo, la entrega de un fallo persistente a S3 y la recuperación sin duplicar registros.

## Evidencia local del 20 de noviembre de 2026

| Revisión | Comprobación | Resultado observado |
| --- | --- | --- |
| `cf5c354` | `node --test pruebas/auditoria.test.mjs` antes de la corrección | Tres de seis pruebas fallaron. Entre los fallos estuvieron el rechazo de una clave válida sin extensión y una confirmación incorrecta del reproceso. |
| `39ac04a` | Selección P-09 del [protocolo](quickstart.md) | Siete de siete pasaron, incluidas las seis nuevas. El doble de AWS ejercita el lector del archivo, la invocación y la respuesta. |
| `39ac04a` | `node --test pruebas/*.test.mjs` | 21 de 21 pruebas pasaron. |
| `39ac04a` | `node scripts/verificar-politicas.mjs` | Se comprobaron los controles en doce archivos Terraform. |
| `39ac04a` | `pnpm run build` y `pnpm run package:lambda` | Astro generó dos páginas y se produjeron los paquetes de API y auditoría. |
| `39ac04a` | Comprobación de requisitos de Spec Kit con `-RequireSpec -RequireTasks` | La herramienta localizó la especificación, el plan y las tareas de la iniciativa 001. |
| `e8e1b17` | Prueba explícita del número de escrituras y repetición de la suite | Se observaron tres inserciones para tres revisiones y una sola inserción al reprocesar dos veces un lote de un cambio. En GitHub Actions pasaron Agenda y Terraform. [Ejecución verificada](https://github.com/aisergio/MediPoli/actions/runs/44856716255) |

La [suite P-09](../../pruebas/auditoria.test.mjs) incluye el caso de compatibilidad con archivos anteriores. El [caso de integración con la reserva](../../pruebas/integracion.test.mjs) usa el movimiento creado por la agenda. La evidencia del mapeo administrado, sus reintentos y la entrega a S3 se obtiene con T07.

## Preparación de T07 el 21 de noviembre de 2026

El [ensayo automatizado](../../scripts/ensayar-auditoria-dev.mjs) comprueba los recursos de dev, genera dos citas sintéticas, busca el lote que emite el mapeo y repite su recuperación. El resultado privado incluye el hash de Lambda, las filas verificadas y la limpieza.

El comando completo se ejecutó con AWS CLI contra servicios simulados por HTTP local. La cita de control produjo tres filas. El otro movimiento produjo tres intentos fallidos simulados y un archivo. Dos reprocesos guardaron una sola fila de recuperación. El ensayo retiró la política y las dos filas de origen del doble de prueba. Pasaron también las 21 pruebas del repositorio.

La renovación del perfil `medipoli` habilitó el ensayo en AWS. [Comandos y evidencia esperada](quickstart.md)

## Evidencia en AWS dev del 21 de noviembre de 2026

Cuenta MediPoli en plan Free y región `us-east-2`. La revisión `749b842` activó el flujo independiente de auditoría con `enable_audit=true`. Terraform creó ocho recursos, activó Streams en la tabla de agenda y registró cero eliminaciones. El segundo plan terminó sin cambios.

| Comprobación | Resultado en AWS dev |
| --- | --- |
| Historial de control | DynamoDB Streams y Lambda registraron una reserva, una reprogramación y una cancelación. Se verificaron las tres filas, sus revisiones y sus campos de correlación. |
| Fallo persistente | CloudWatch mostró el fallo inicial y dos reintentos del mismo evento sintético. Las tres filas de la cita de control permanecieron disponibles. |
| Archivo real en S3 | Lambda conservó un registro con motivo `RetryAttemptsExhausted` a las `2026-11-22T00:02:21.624Z`. La clave del objeto terminaba sin extensión. |
| Recuperación | El primer reproceso exitoso se confirmó a las `2026-11-22T00:05:50.385Z` y el segundo a las `2026-11-22T00:07:12.165Z`. DynamoDB devolvió la misma fila en las dos lecturas. CloudWatch mostró la inserción y el reconocimiento del duplicado. |
| Limpieza | El ensayo retiró las dos filas sintéticas de origen y la política temporal. Conservó las filas de auditoría y el objeto de fallo para revisión. |

El ensayo empezó con escrituras sintéticas en la tabla de agenda. La entrega fuera de orden y el lote mixto con respuesta parcial también se verifican en las pruebas locales de P-09. En el primer ensayo real se conservó el mismo objeto al reintentar después de que se propagara el permiso restaurado. La revisión `44b2efe` amplió la espera del reproceso a cuatro minutos. La revisión `20a003e` incorporó una sonda de Lambda para verificar la propagación inicial antes de generar el evento destinado a fallar. [Pruebas P-09](../../pruebas/auditoria.test.mjs) · [Propagación de cambios de IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html#troubleshoot_general_eventual-consistency)

El manifiesto privado del ensayo de la revisión `a638272`, el objeto original y las dos comprobaciones quedan bajo `evidencia/privada/`. La huella SHA-256 del objeto archivado es `22962d674057bc8f04b167ecdce0cddda1197c6c00199880efe3981141e4ad19`.
