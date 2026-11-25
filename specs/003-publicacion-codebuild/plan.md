# Plan de publicación desde AWS

CodeConnections entrega a CodeBuild el código del repositorio. GitHub Actions continúa ejecutando las comprobaciones de revisión. CodeBuild usa el archivo `buildspec.dev.yml`, Node 24, el archivo de bloqueo de pnpm y el script `scripts/publicar.mjs`.

El rol existente de CodeBuild conserva el acceso necesario a la conexión y a sus registros. Los permisos de publicación de Terraform se reutilizan para la función de agenda, la función consumidora, los alias `live` y `candidate`, el prefijo `MediPoli/` del portal y la distribución CloudFront de desarrollo.

La primera publicación usa `directo-dev`. Se verifica la versión anterior, la candidata, el alias final, el portal y el estado de la API. La prueba de tráfico gradual se ejecutará con credenciales temporales de un paciente ficticio y conservará su evidencia propia.
