# MP-09 · Diseño y verificación

Unidad 3 · 20 de noviembre de 2026 · [Criterios de aceptación](spec.md) · [Constitución](../../.specify/memory/constitution.md)

## Recorrido de un cambio

La operación de agenda confirma la escritura de la cita y su número de revisión. DynamoDB Streams entrega las imágenes nuevas. El mapeo de Lambda selecciona inserciones y modificaciones de citas. El consumidor escribe una fila por clave `EVENT#<cita>#<revisión>`. La escritura condicional conserva la primera entrada al repetir una entrega. El número de revisión permite reconstruir el orden aunque los avisos lleguen desordenados. [Operaciones de agenda](../../src/backend/agenda.mjs) · [Consumidor](../../src/backend/auditoria.mjs) · [Escritura condicional](../../src/backend/dynamodb.mjs)

**Figura 1. Procesamiento y recuperación.** Siga la rama de «Nueva clave» para la primera entrega, la de «Clave existente» para un duplicado y la de «Fallo» para el tratamiento de una interrupción. El retorno desde S3 representa la intervención de operación después de corregir la causa. El dibujo describe el diseño versionado. La verificación de cada ambiente se consigna en las tareas. [Diagrama Mermaid editable](../../diagramas/u3/05-eventos.mmd)

## Respuesta parcial y destino de fallos

El consumidor devuelve los números de secuencia de las entradas fallidas en `batchItemFailures`. Lambda puede volver a entregar también entradas posteriores al primer fallo, por lo que todas las escrituras deben tolerar duplicados. Terraform configura lotes de diez registros, dos reintentos, una antigüedad máxima de una hora, división de lotes ante errores y un bucket privado de S3 como destino. El grupo de registros tiene siete días de retención. [Mapeo y permisos](../../infra/ambiente/eventos.tf) · [Respuesta parcial de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-ddb-batchfailurereporting.html)

Al archivar un fallo de DynamoDB Streams, AWS guarda el evento original serializado en el campo `payload`. La clave del objeto bajo `aws/lambda/` puede terminar en un identificador sin extensión. El comando de MediPoli descargará el objeto del bucket del ambiente seleccionado, validará el lote e invocará el consumidor de ese ambiente. Seguirá leyendo los archivos anteriores que usen `requestPayload`. La recuperación exige una invocación correcta y una lista explícita y vacía de fallos. El objeto original permanece disponible para repetir la comprobación. [Formato oficial del destino S3](https://docs.aws.amazon.com/lambda/latest/dg/services-dynamodb-errors.html) · [Comando de recuperación](../../scripts/reprocesar-evento.mjs)

## Pruebas y evidencia

| Criterios | Verificación local | Evidencia prevista en AWS dev |
| --- | --- | --- |
| CA-01, CA-02 y CA-05 | Intercalar tres revisiones, repetirlas, comparar las entradas exactas y examinar los diagnósticos con marcadores sintéticos. | Comparar cita, revisiones, solicitudes y cantidad de filas después de la reserva, reprogramación y cancelación. |
| CA-03 | Forzar una escritura fallida junto a otra correcta y repetir el lote. | Relacionar el fallo observado con la solicitud y comprobar las filas finales. |
| CA-04 | Pasar un objeto con el formato publicado por AWS por el comando, probar la repetición y rechazar resultados parciales o ilegibles. | Identificar el objeto emitido por el mapeo después de agotar los reintentos y comprobar la recuperación de extremo a extremo. |

El ensayo de recuperación usa datos ficticios en `dev`. El script escribe cambios sintéticos en la agenda y verifica la entrega por el mapeo administrado. Su política temporal restringe una sola clave de auditoría y comprueba el permiso de una cita de control. Los resultados públicos contienen fecha, revisión, ambiente y cantidades. El lote completo y los identificadores de la cuenta permanecen en la evidencia privada. [Protocolo reproducible](quickstart.md) · [Ensayo automatizado](../../scripts/ensayar-auditoria-dev.mjs) · [Control por clave en DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html) · [Estado de las tareas](tasks.md)
