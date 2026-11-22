# MediPoli

Prototipo académico de una IPS ficticia de Bogotá. El escenario representa tres sedes, personal y pacientes ficticios, y dos servicios de la EPS ficticia SaludCol. El proyecto utiliza exclusivamente datos de demostración.

| Unidad | Resultado | Evidencia |
| --- | --- | --- |
| U2 | Arquitectura y base reproducible | [Infraestructura](infra/) · [Diagramas](diagramas/u2/) · [Verificación](docs/u2-verificacion.md) |
| U3 | Agenda, MCP y auditoría por eventos | [Verificación en AWS dev](docs/u3-verificacion.md) · [Diagramas U3](diagramas/u3/) |
| U4 | Despliegue progresivo, recuperación y telemetría | Flujo de release, mediciones y guías de operación |

## Desarrollo guiado por especificaciones

En cada mejora de U3 y U4 se usa esta secuencia.

1. Consultar la [constitución de MediPoli](.specify/memory/constitution.md).
2. Escribir la historia y ejemplos comprobables en `spec.md`. Referenciar el requisito del curso.
3. Documentar en `plan.md` el diseño, el diagrama pertinente y cómo se observará el resultado.
4. Derivar tareas pequeñas en `tasks.md`, implementar sus pruebas y registrar ambiente, revisión y resultado.

La [auditoría de citas MP-09](specs/001-auditoria-citas/spec.md), su [plan](specs/001-auditoria-citas/plan.md) y sus [tareas](specs/001-auditoria-citas/tasks.md) muestran la secuencia completa. La [ficha MP-04](docs/especificaciones/MP-04-reserva.md) documenta las reglas de reserva ya verificadas.

El repositorio incluye la integración de Spec Kit para Codex y los scripts de PowerShell. Al abrirlo en una sesión nueva de Codex se pueden invocar `$speckit-specify`, `$speckit-plan`, `$speckit-tasks` y `$speckit-implement` en ese orden. La constitución se actualiza cuando cambia una regla de todo el proyecto. [Integración oficial de Codex](https://github.github.com/spec-kit/integrations/codex.html)

## Base reproducible

Requisitos locales: Terraform 1.14.3 o compatible, AWS CLI v2 y una sesión temporal del proyecto dedicado. La región debe coincidir con la mostrada en AWS Settings.

```powershell
terraform fmt -recursive -check infra
terraform -chdir=infra/ambiente init -backend=false
terraform -chdir=infra/ambiente validate
```

Confirme el proyecto y su plan en **AWS Settings** antes de aplicar. U2 admite la base dev en Free con alertas por correo en el presupuesto del proyecto. La pausa integral a USD 50 es un control de Paid. Consulte el [procedimiento U2](docs/u2-verificacion.md) y mantenga los datos de sesión y planes fuera del repositorio.

Las fuentes Mermaid se pueden importar en Mermaid.ai. Se identifican por unidad y número de figura. Las capturas, resultados y gráficas que se presenten como evidencia de ejecución deben proceder del entorno de verificación correspondiente.
