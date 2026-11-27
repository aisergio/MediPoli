# Tareas y comprobaciones

- [x] Definir las dos consultas y sus criterios IA-01 a IA-04.
- [x] Implementar el catálogo, la API y la sección de agenda.
- [x] Validar el acceso, el respaldo con catálogo y la reserva de capacidad diaria.
- [x] Verificar la titularidad en el estado de Terraform, aplicar la configuración en AWS y publicar con CodeBuild en desarrollo.
- [x] Registrar la revisión publicada y la prueba autenticada de las dos consultas.

La compilación 8 de CodeBuild publicó la revisión `412ab33` en desarrollo el 27 de noviembre de 2026 a las 06:33 de Bogotá. La API respondió con la versión 10. [Validación de la revisión](https://github.com/aisergio/MediPoli/actions/runs/45988978948)

Las pruebas de la agenda obtuvieron HTTP 401 sin sesión y HTTP 200 con sesión para sedes y servicios. El portal mostró los datos del catálogo cuando la consulta de sedes usó el respaldo en la primera prueba. En la segunda prueba ambas consultas fueron asistidas por Bedrock. Se retiraron y verificaron los usuarios y perfiles sintéticos. [Agenda de desarrollo](https://aisergio.dev/MediPoli/agenda/)
