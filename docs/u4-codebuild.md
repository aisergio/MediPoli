# Publicación de MediPoli dev con CodeBuild

El 25 de noviembre de 2026 se comprobó el despliegue automático del ambiente de desarrollo en Ohio. La primera compilación automatizada se originó en un envío a GitHub, duró 71 segundos y activó la versión 5 de Lambda. Otro envío publicó la versión 6 y habilitó la prueba del MCP en el dominio público. [Portal de MediPoli](https://dv41a4jtx3h0h.cloudfront.net/MediPoli/) · [Solicitud de revisión](https://github.com/aisergio/MediPoli/pull/4)

## Flujo de publicación

GitHub contiene el código y ejecuta las comprobaciones de Agenda y Terraform. La conexión `medipoli-github` permite a CodeBuild obtener el repositorio. Un webhook filtra los envíos a `003-publicacion-codebuild` que cambian la aplicación, los scripts, las dependencias o la especificación de compilación. CodeBuild instala Node.js 24 y pnpm, verifica dependencias y políticas, ejecuta las pruebas y construye los paquetes. El paso de publicación utiliza las credenciales temporales del rol del propio proyecto. [Diagrama del flujo](../diagramas/u4/01-pipeline.mmd) · [Especificación de compilación](../buildspec.dev.yml)

La política publicada por AWS para los proyectos Free restringe las acciones IAM sobre proveedores de identidad. CodeBuild y CodeConnections están permitidos por la política y la compilación comprobó su uso conjunto en MediPoli. [Política de control del plan Free](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html)

## Configuración reproducible

1. Abrir el proyecto MediPoli en Ohio y verificar que `medipoli-github` esté disponible.
2. Seleccionar `aisergio/MediPoli` como origen del proyecto privado `medipoli-dev`. Usar el contenedor administrado de Amazon Linux 2023 `standard:6.0`, bajo demanda y con tipo Small.
3. Asociar el rol `codebuild-medipoli-dev-service-role` al proyecto. La confianza requiere la cuenta de MediPoli y el ARN exacto del proyecto. Los permisos de publicación cubren las funciones de agenda y auditoría, los alias, los archivos del portal y la invalidación de la distribución de desarrollo. [Política versionada](../infra/ambiente/politica-publicacion.json.tftpl) · [Rol de servicio de CodeBuild](https://docs.aws.amazon.com/codebuild/latest/userguide/setting-up-service-role.html)
4. Seleccionar `buildspec.dev.yml`. Cargar las direcciones del portal, API y Cognito desde la salida `application` de Terraform. La rama de desarrollo usa `MEDIPOLI_ENV=dev` y `RELEASE_MODE=directo-dev`.
5. Permitir una ejecución simultánea y revisar las fases y el commit resuelto en CloudWatch. El filtro del webhook limita la publicación a los envíos de la rama de desarrollo y a los archivos de aplicación que pueden modificar el resultado.

## Evidencia observada

| Compilación | Inicio y fin, Bogotá | Revisión | Resultado |
| --- | --- | --- | --- |
| 1 | 00:11:48–00:12:25 | `934eb4d` | Descarga desde GitHub, 21 pruebas y dos páginas compiladas. |
| 2 | 00:25:14–00:26:26 | `574601c` | La candidata 4 respondió. La primera comprobación tras promoverla todavía recibió la versión 3. La ejecución revirtió la publicación y se confirmó el alias estable en la versión 3. |
| 3 | 00:30:10–00:31:21 | `d37cfab` | GitHub disparó CodeBuild. Pasaron 21 pruebas y se publicaron dos páginas. La API respondió con la versión 5. |
| 4 | 00:52:20–00:53:24 | `08d439e` | GitHub disparó CodeBuild. Pasaron 22 pruebas. La comprobación posterior al cambio de alias observó la versión 6 en el segundo intento. |

La corrección espera hasta veinte segundos a que la API responda con la versión esperada. También registra los intentos y comprueba la versión después de una reversión. Las restauraciones del portal se intentan aunque falle una comprobación de la API. En la ejecución 3, CloudFront completó la invalidación. El portal, la agenda y la ruta de salud devolvieron HTTP 200, y una consulta de perfil sin sesión devolvió HTTP 401.

La ejecución 3 fue una publicación directa de dev. El canario usa una configuración de ejecución propia y observa el reparto de tráfico en el alias de Lambda. La recuperación de datos se ensaya por separado.

## Ensayo de publicación gradual

1. Seleccionar una revisión de la aplicación con las validaciones aprobadas y confirmar la versión estable en el alias `live`.
2. Autenticar en la agenda un paciente ficticio de la prueba. Cargar su token temporal como `SecureString` de Standard en `/medipoli/dev/canary/access-token`. El rol de CodeBuild tiene permiso de lectura sobre ese parámetro. [Parámetros seguros de CodeBuild](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html)
3. Iniciar una compilación de `medipoli-dev` con la revisión exacta. Seleccionar `RELEASE_MODE=canary` y pasar `SMOKE_ACCESS_TOKEN` con tipo `PARAMETER_STORE`. Usar `MEDIPOLI_TEST_ROLLBACK=true` para el ensayo del fallo.
4. Revisar el peso de 0,10 en el alias `live`. La versión devuelta por cada consulta permite atribuir el resultado a la estable o a la candidata. CodeBuild imprime el resumen del muestreo en CloudWatch. [Alias ponderados de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html)
5. Comprobar la versión que responde a la ruta de salud después de la promoción o la reversión. En el ensayo con fallo, revisar la retirada de la ponderación y la restitución del alias de candidata. Retirar el parámetro, la cuenta y el perfil temporales al terminar.

El peso expresa una probabilidad de enrutamiento. El análisis registra por separado el peso configurado y las muestras observadas por versión. Los percentiles miden la consulta completa desde el cliente de CodeBuild. [Diagrama del canario](../diagramas/u4/02-canary.mmd) · [Diagrama editable en Mermaid Chart](https://mermaid.ai/app/projects/13439b10-64c9-477b-aae9-bc2ac5fc1a54/diagrams/e5a97327-4c30-4bca-a652-7b51632fbb22/version/v0.1/edit?utm_source=mermaid_app_widget&utm_medium=mermaid-chatgpt-app)

| Ensayo del 27 de noviembre de 2026 | Evidencia |
|---|---|
| Compilación 9 · Promoción | Alias ponderado al 10 % durante 300,8 segundos. La versión 11 respondió correctamente en 136 de 1683 consultas totales. P95 de 137 ms y p99 de 382 ms. El alias `live` terminó en la versión 11. |
| Compilación 10 · Reversión | Alias ponderado al 10 % durante 300,8 segundos. La versión 12 produjo 157 respuestas HTTP 503 controladas y la versión 11 completó 1537 consultas. CodeBuild retiró la ponderación y la versión 11 respondió HTTP 200. |

La prueba de reversión correlacionó un HTTP 503 de API Gateway con el evento de Lambda y observó el cambio de la alarma de errores a `ALARM`. Ambos ensayos usaron la revisión `292a1a6` y se verificó la retirada de las sesiones y los perfiles sintéticos. [Promoción en CloudWatch](https://console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/$252Faws$252Fcodebuild$252Fmedipoli-dev/log-events/80ea2462-b247-4f47-946e-256348278b27) · [Reversión en CloudWatch](https://console.aws.amazon.com/cloudwatch/home?region=us-east-2#logsV2:log-groups/log-group/$252Faws$252Fcodebuild$252Fmedipoli-dev/log-events/1ed91f8a-3478-4d7e-8316-28cbc5850bda)

## Estado de Terraform

El 27 de noviembre de 2026 se importaron dos recursos que ya funcionaban y coincidían con la declaración. La política `PublicarVersionesYObjetos` quedó en `aws_iam_role_policy.codebuild[0]`. El servidor OAuth del dominio público del MCP quedó en `aws_cognito_resource_server.mcp_public[0]`. Las importaciones se verificaron en el estado versionado de desarrollo en S3. [Definición de permisos](../infra/ambiente/permisos_publicacion.tf) · [Declaración de Cognito](../infra/ambiente/identidad.tf)

Después de los ensayos del canario, la alarma de errores de API regresó a `OK` a las 07:45:26 de Bogotá. El plan de la revisión del canario terminó con cero recursos por crear, modificar o eliminar, con el permiso de lectura del parámetro temporal registrado en la política declarada.

Para reproducir la comparación, usa el estado de desarrollo en Ohio y los parámetros privados habituales de la aplicación. Incluye `codebuild_release_role_name=codebuild-medipoli-dev-service-role` para que Terraform evalúe la política del rol existente. El plan ejecutado en Ubuntu con Terraform 1.14.3 dio 0 recursos por crear, modificar o eliminar. La ruta de salud de la API respondió con la versión 10 después de la comprobación. [Ruta de salud](https://aisergio.dev/MediPoli/api/health)
