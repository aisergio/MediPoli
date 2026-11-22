# MP-09 · Historial de cambios de las citas

Unidad 3 · Requisito MP-09 · Prueba del curso P-09 · 20 de noviembre de 2026

Al coordinar las tres sedes, el equipo de operación necesita explicar qué pasó con una cita aunque una notificación se repita o llegue tarde. El paciente recibe la confirmación de su operación y el equipo puede reconstruir cada cambio con la información mínima necesaria.

## Historias y criterios de aceptación

| Criterio | Dado que | Cuando | Entonces |
| --- | --- | --- | --- |
| CA-01 · Seguir una cita | Una cita se reserva, luego se reprograma y finalmente se cancela | Operación reconstruye lo ocurrido, incluso si los avisos llegan fuera de orden | Encuentra una entrada por revisión y puede relacionar cada cambio con su solicitud y momento originales. |
| CA-02 · Reconocer una repetición | Ya hay una entrada para una cita y una revisión | Vuelve a llegar ese cambio, incluso junto a uno nuevo | El historial conserva la entrada original y registra una sola vez el cambio nuevo. |
| CA-03 · Conservar los avances | Se reciben cambios de varias citas y falla el registro de uno de ellos | Se evalúa el resultado y se repite el trabajo afectado | Se identifica el cambio pendiente. Las entradas correctas se conservan. Tras corregir la causa, cada cambio queda registrado una vez. |
| CA-04 · Recuperar un lote | Un fallo persiste y el lote original se conserva para operación | La persona encargada corrige la causa y vuelve a procesar ese lote | Solo recibe confirmación si todos sus cambios quedaron atendidos. Puede repetir el proceso y obtiene el mismo historial. |
| CA-05 · Proteger los datos | Los movimientos de la agenda contienen información del paciente y datos ajenos a la auditoría | Se registra el historial o se emite un mensaje de diagnóstico | La entrada de historial contiene solo identificadores de cita, revisión y solicitud, tipo de movimiento, fecha, sede y servicio, además de las claves internas de la entrada. Los diagnósticos excluyen identidades de pacientes, secretos e información clínica. Los cambios ajenos a citas se omiten. |

**Prioridad.** La trazabilidad del movimiento y la privacidad son necesarias en cada reserva (CA-01, CA-02 y CA-05). Operación necesita además conservar avances y recuperar el historial tras una interrupción (CA-03 y CA-04).

**Resultado observable.** Para una cita con tres revisiones distintas, el historial contiene exactamente tres entradas aunque se vuelvan a recibir todas. Si queda un cambio pendiente o el resultado de la recuperación es ilegible, operación recibe un fallo verificable. El historial de este ejercicio se consulta como evidencia operativa del curso. El alcance funcional de la pantalla administrativa sigue siendo el acordado en MediPoli.
