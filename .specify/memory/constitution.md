# Constitución de MediPoli

Versión 1.0.0 · Adoptada el 20 de noviembre de 2026.

## I. Las reglas de la IPS se especifican primero

MediPoli es una IPS ficticia en Bogotá que atiende a afiliados de la EPS ficticia SaludCol. El escenario de demostración tiene tres sedes, cinco profesionales empleados por sede y veinte pacientes ficticios por sede. Cada franja dura treinta minutos. Un paciente puede tener una cita futura por servicio entre todas las sedes. Los servicios son medicina general y odontología. El pago presencial ocurre fuera de la aplicación.

La web y el MCP comparten las reglas de agenda. Cada paciente accede a sus propias citas y cada profesional a su propia agenda. La administración se limita a altas y reportes de cantidades. Las historias clínicas, la facturación y la integración con una EPS quedan fuera del alcance académico acordado.

## II. Un comportamiento tiene una prueba observable

Cada cambio funcional empieza por una historia y ejemplos de aceptación con un identificador estable. Una regla existente puede documentarse a partir de su comportamiento comprobado. Una regla que cambia debe expresarse en la especificación antes de editar el código. Si un ejemplo revela un defecto reproducible, se conserva una prueba que falle con la versión afectada.

## III. Los datos y el acceso se limitan al propósito del ejercicio

Se usan datos sintéticos y permisos por rol y ambiente. La bitácora puede correlacionar cita, revisión y solicitud. Los registros y la evidencia pública excluyen credenciales, identificadores de pacientes e información clínica. Los archivos de estado, lotes de fallos y configuraciones privadas se guardan fuera del repositorio público.

## IV. Cada evidencia identifica lo que se observó

La tarea relaciona requisito, prueba y resultado con su ambiente, fecha y revisión. Las pruebas locales acreditan reglas y contratos. Para afirmar que una integración funcionó en AWS se necesita una ejecución en el ambiente correspondiente. Una prueba de recuperación incluye la comprobación del estado final.

## V. Los cambios respetan la operación acordada

La infraestructura se gestiona con Terraform. Las validaciones se ejecutan en GitHub Actions y los cambios se revisan en una solicitud de incorporación. La promoción a producción requiere aprobación explícita. El presupuesto de AWS es de USD 50 mensuales. Se conserva el plan elegido y se mantienen desactivadas las funciones avanzadas. Las alertas de presupuesto se registran como avisos de consumo.

## Flujo de trabajo y mantenimiento

Para cada mejora se conserva una carpeta en `specs/` con `spec.md` (qué necesita la persona), `plan.md` (cómo se realizará) y `tasks.md` (qué pruebas y evidencias la cierran). Antes de empezar la siguiente tarea se consulta su criterio de aceptación. La revisión del cambio contrasta el resultado con ese criterio. Las decisiones que afecten a todo el proyecto se actualizan aquí, con su versión, fecha y motivo en la solicitud de cambios.
