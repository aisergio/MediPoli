# Implementación de la recepción

Conservar la fotografía aprobada en WebP con encuadres horizontal y vertical. Astro generará tamaños responsivos con rutas ligadas a la compilación bajo `/MediPoli/`.

Agregar una capa fija y decorativa a `src/pages/index.astro`. Usar estilos propios de la portada para delimitarla, ajustar el encuadre y dar contraste a los textos. La preferencia de movimiento reducido cambia la capa fija por una capa que se desplaza junto al contenido.

Comprobar la portada y la agenda con una compilación local antes de la validación en GitHub. Publicar la portada y sus activos en el ambiente de desarrollo con CodeBuild a partir del commit validado. La publicación reemplaza el HTML de inicio, conserva su versión anterior en S3 e invalida las rutas de la portada en CloudFront.
