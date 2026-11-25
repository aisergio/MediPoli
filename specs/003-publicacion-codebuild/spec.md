# Publicación de MediPoli desde CodeBuild

- Entrega objetivo de automatización y evidencia para U4.
- El proyecto de compilación `medipoli-dev` lee `aisergio/MediPoli` mediante `medipoli-github`.
- La publicación se ejecuta en el ambiente de desarrollo después de instalar dependencias, comprobar políticas, ejecutar pruebas y construir el portal y las funciones.
- Una compilación satisfactoria publica una versión candidata, verifica su respuesta y deja activa la versión validada. Las evidencias asocian el resultado con el commit que descargó CodeBuild.
- Un fallo previo a publicar conserva la versión estable. Si falla la publicación después de cambiar el alias, se comprueba que el alias vuelva a la versión estable.
- Se aplica el presupuesto de MediPoli y se conserva el plan Free. La publicación inicial usa ejecución manual y computación bajo demanda.
