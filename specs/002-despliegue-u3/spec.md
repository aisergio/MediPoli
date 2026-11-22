# Unidad 3 · Agenda de MediPoli en desarrollo

Fecha de inicio · 21 de noviembre de 2026, Bogotá.

## Propósito

Un paciente ficticio puede entrar a la agenda de MediPoli, consultar franjas de las tres sedes y gestionar sus citas. Un profesional consulta su propia agenda. Administración gestiona altas ficticias y consulta cantidades. Una persona de operación puede seguir los cambios de cita en la bitácora y recuperar un evento que agotó sus reintentos.

## Criterios de aceptación

| ID | Ejemplo que debe poder comprobarse |
| --- | --- |
| U3-01 | Al abrir la dirección HTTPS de desarrollo se carga el portal y su agenda. Una comprobación pública confirma que la API responde y una consulta privada sin sesión se rechaza. |
| U3-02 | Un paciente ficticio inicia sesión, encuentra una franja, reserva, confirma su cita, la reprograma y la cancela. El historial conserva las tres revisiones y el estado final es cancelado. |
| U3-03 | Otro paciente ve sus propias citas. Un profesional ve únicamente su agenda. Las operaciones de administración quedan reservadas a su rol. |
| U3-04 | La aplicación ofrece consulta y reserva asistida a un cliente MCP autorizado por el paciente. Una operación sin autorización se rechaza y una reserva requiere confirmación explícita. |
| U3-05 | Cada prueba real queda asociada a un ambiente, una fecha, una revisión y un resultado. La evidencia para el curso explica el comportamiento bajo carga y la observación del flujo sin publicar datos de acceso. |

El alcance de la aplicación sigue el escenario académico de la IPS y usa solo datos ficticios. Las pruebas deben demostrar el recorrido conectando los componentes aprovisionados y la infraestructura de la Unidad 2. [Constitución de MediPoli](../../.specify/memory/constitution.md) · [Especificación de auditoría](../001-auditoria-citas/spec.md)
