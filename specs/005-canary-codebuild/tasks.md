# Tareas de publicación gradual

- [x] U4-C01 a U4-C04 · Definir los criterios del ensayo y acotar su alcance al ambiente de desarrollo.
- [x] U4-C01 · Habilitar el modo gradual en CodeBuild, validar el paciente sintético y revisar los permisos en Terraform.
- [x] U4-C02 · Ejecutar y documentar el canario con promoción.
- [x] U4-C03 · Ejecutar y documentar el canario con fallos controlados y reversión comprobada.
- [x] U4-C04 · Conservar las métricas y comprobar la limpieza de la sesión y los datos de prueba.

La compilación 9 promovió la versión 11 después de una ventana de 300,8 segundos con un peso de 10 %. Respondió la candidata en 136 de 1683 consultas y completó todas ellas correctamente. El p95 fue 137 ms y el p99 fue 382 ms. [Validaciones de la revisión](https://github.com/aisergio/MediPoli/actions/runs/45998485627)

La compilación 10 comprobó 157 fallos controlados de la candidata 12. Se retiró la ponderación, el alias estable volvió a la versión 11 y la ruta pública de salud devolvió HTTP 200. Se verificó la limpieza del parámetro temporal, la cuenta y el perfil del ensayo. [Registro de CodeBuild](https://console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/$252Faws$252Fcodebuild$252Fmedipoli-dev/log-events/1ed91f8a-3478-4d7e-8316-28cbc5850bda)
