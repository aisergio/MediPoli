# MP-09 · Tareas y trazabilidad

Unidad 3 · Corte del 20 de noviembre de 2026. Cada casilla se cierra con la comprobación de la fila.

- [x] T01 · Enlazar MP-09 y P-09 con cinco criterios en la [especificación](spec.md) y definir su alcance con la [constitución](../../.specify/memory/constitution.md).
- [x] T02 · Contrastar el [diseño existente](plan.md) y el formato del objeto de fallos con el ejemplo de AWS.
- [x] T03 · CA-01, CA-02 y CA-05. Tres revisiones fuera de orden conservaron el historial mínimo. La repetición mantuvo el identificador de solicitud original y el diagnóstico excluyó los marcadores de datos privados.
- [x] T04 · CA-03. Un fallo de escritura devolvió la secuencia pendiente. Al repetir el lote, la entrada ya guardada conservó su contenido y se recuperó la pendiente.
- [x] T05 · CA-04. Se reprodujo el rechazo de la clave sin extensión. El comando corregido leyó el objeto de prueba con el formato publicado por AWS, conservó la compatibilidad anterior y rechazó resultados parciales o ilegibles.
- [x] T06 · Ejecutar las validaciones locales y asociar los resultados a la revisión.
- [ ] T07 · CA-01 a CA-05 en AWS dev. Observar el flujo del mapeo, la entrega de un fallo persistente a S3 y la recuperación. Guardar las cantidades antes y después con fecha y revisión.

## Evidencia local del 20 de noviembre de 2026

| Revisión | Comprobación | Resultado observado |
| --- | --- | --- |
| `cf5c354` | `node --test pruebas/auditoria.test.mjs` antes de la corrección | Tres de seis pruebas fallaron. Entre los fallos estuvieron el rechazo de una clave válida sin extensión y una confirmación incorrecta del reproceso. |
| `39ac04a` | Selección P-09 del [protocolo](quickstart.md) | Siete de siete pasaron, incluidas las seis nuevas. El doble de AWS ejercita el lector del archivo, la invocación y la respuesta. |
| `39ac04a` | `node --test pruebas/*.test.mjs` | 21 de 21 pruebas pasaron. |
| `39ac04a` | `node scripts/verificar-politicas.mjs` | Se comprobaron los controles en doce archivos Terraform. |
| `39ac04a` | `pnpm run build` y `pnpm run package:lambda` | Astro generó dos páginas y se produjeron los paquetes de API y auditoría. |
| `39ac04a` | Comprobación de requisitos de Spec Kit con `-RequireSpec -RequireTasks` | La herramienta localizó la especificación, el plan y las tareas de la iniciativa 001. |

La [suite P-09](../../pruebas/auditoria.test.mjs) incluye el caso de compatibilidad con archivos anteriores. El [caso de integración con la reserva](../../pruebas/integracion.test.mjs) usa el movimiento creado por la agenda. La evidencia del mapeo administrado, sus reintentos y la entrega a S3 se obtiene con T07.
