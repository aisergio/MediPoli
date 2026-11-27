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

La ejecución 3 fue una publicación directa de dev. Las mediciones del canario al 10 % y la recuperación de datos se documentarán con sus propios ensayos.

## Estado de Terraform

El 27 de noviembre de 2026 se importaron dos recursos que ya funcionaban y coincidían con la declaración. La política `PublicarVersionesYObjetos` quedó en `aws_iam_role_policy.codebuild[0]`. El servidor OAuth del dominio público del MCP quedó en `aws_cognito_resource_server.mcp_public[0]`. Las importaciones se verificaron en el estado versionado de desarrollo en S3. [Definición de permisos](../infra/ambiente/permisos_publicacion.tf) · [Declaración de Cognito](../infra/ambiente/identidad.tf)

Para reproducir la comparación, usa el estado de desarrollo en Ohio y los parámetros privados habituales de la aplicación. Incluye `codebuild_release_role_name=codebuild-medipoli-dev-service-role` para que Terraform evalúe la política del rol existente. El plan ejecutado en Ubuntu con Terraform 1.14.3 dio 0 recursos por crear, modificar o eliminar. La ruta de salud de la API respondió con la versión 10 después de la comprobación. [Ruta de salud](https://aisergio.dev/MediPoli/api/health)
