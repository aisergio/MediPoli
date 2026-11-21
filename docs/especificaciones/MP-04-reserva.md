# MP-04 Reserva exclusiva e idempotente

Esta ficha piloto de U3 recoge la regla de reserva que ya implementa MediPoli. Corresponde a los casos de uso CU-08 y CU-14 y a la prueba P-04 de la hoja «Trazabilidad» del libro de requisitos.

## Comportamiento esperado

Un paciente autenticado puede reservar una franja futura disponible. Cada franja admite una sola cita y cada paciente puede tener una cita futura de medicina general y otra de odontología entre las tres sedes. Si la conexión se interrumpe después de confirmar una cita, el paciente debe poder reintentar la misma solicitud y recuperar su confirmación.

## Criterios de aceptación

| Dado que | Cuando | Entonces |
| --- | --- | --- |
| Dos pacientes pueden reservar la misma franja libre | Envían sus solicitudes al mismo tiempo | Uno obtiene la confirmación, el otro recibe un conflicto y queda registrada una sola cita para esa franja. |
| Un paciente ya tiene una cita futura de medicina general | Intenta reservar otra de medicina general en otra sede | La segunda reserva se rechaza. El paciente conserva su cita y puede reservar odontología si tiene una franja disponible y el cupo de ese servicio libre. |
| Un paciente envía dos veces la misma reserva | Ambas solicitudes usan la misma clave de idempotencia y la misma franja | Las dos respuestas contienen el mismo identificador de cita y solo se registra una reserva. |
| Un paciente ya usó una clave para reservar | Vuelve a usar esa clave con una franja distinta | Recibe un conflicto. La clave sigue asociada a la solicitud original. |

## Diseño

La web y el MCP llaman a la misma operación de agenda. Una transacción ocupa la franja, asigna el cupo del paciente para el servicio, crea la cita y guarda el resultado asociado a la clave de la solicitud. Así, una confirmación corresponde a un único cambio de agenda. [Diagrama de secuencia](../../diagramas/u3/02-reserva.mmd) · [Operación de reserva](../../src/backend/agenda.mjs) · [Transacción en DynamoDB](../../src/backend/dynamodb.mjs)

## Verificación y evidencia

El 19 de noviembre de 2026 pasaron las tres pruebas P-04 en la revisión `0c616b1`, con almacenamiento en memoria. La tercera prueba cubre tanto el reintento idéntico como la reutilización de la clave con datos distintos. Desde la raíz del repositorio se pueden reproducir así.

```sh
node --test --test-name-pattern=P-04 pruebas/agenda.test.mjs
```

GitHub Actions tiene configurada la ejecución de la suite al abrir o actualizar una solicitud de cambios. [Pruebas de agenda](../../pruebas/agenda.test.mjs) · [Validación en GitHub Actions](../../.github/workflows/validar.yml)

Para la evidencia de U3 en AWS, repetir los escenarios con pacientes ficticios en `dev`. En el de concurrencia, guardar las dos respuestas y consultar después las agendas para comprobar que solo una contiene la cita. En el de reintento, comparar los identificadores devueltos. Vincular los resultados con la fecha, la revisión desplegada y los identificadores de solicitud.

## Uso en el siguiente cambio

Para una regla nueva, escribir primero el comportamiento y los ejemplos de aceptación. Después, añadir el diseño y las tareas necesarias para cumplirlos. En la solicitud de cambios, enlazar la ficha, las pruebas y su resultado. Si cambia una regla acordada, actualizar su criterio y su prueba en el mismo cambio.
