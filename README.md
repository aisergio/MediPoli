# MediPoli

Prototipo académico de una IPS ficticia de Bogotá. El escenario representa tres sedes, personal y pacientes ficticios, y dos servicios de la EPS ficticia SaludCol. El proyecto utiliza exclusivamente datos de demostración.

| Unidad | Resultado | Evidencia |
| --- | --- | --- |
| U2 | Arquitectura y base reproducible | [Infraestructura](infra/) · [Diagramas](diagramas/u2/) · [Verificación](docs/u2-verificacion.md) |
| U3 | Agenda, MCP y auditoría por eventos | Código y verificaciones de la aplicación |
| U4 | Despliegue progresivo, recuperación y telemetría | Flujo de release, mediciones y guías de operación |

## Base reproducible

Requisitos locales: Terraform 1.14.3 o compatible, AWS CLI v2 y una sesión temporal del proyecto dedicado. La región debe coincidir con la mostrada en AWS Settings.

```powershell
terraform fmt -recursive -check infra
terraform -chdir=infra/ambiente init -backend=false
terraform -chdir=infra/ambiente validate
```

Confirme el proyecto y su plan en **AWS Settings** antes de aplicar. U2 admite la base dev en Free con alertas por correo en el presupuesto del proyecto. La pausa integral a USD 50 es un control de Paid. Consulte el [procedimiento U2](docs/u2-verificacion.md) y mantenga los datos de sesión y planes fuera del repositorio.

Las fuentes Mermaid se pueden importar en Mermaid.ai. Se identifican por unidad y número de figura. Las capturas, resultados y gráficas que se presenten como evidencia de ejecución deben proceder del entorno de verificación correspondiente.
