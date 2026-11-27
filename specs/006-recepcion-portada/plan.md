# Implementación de la recepción

Conservar la fotografía aprobada en WebP con encuadres horizontal y vertical. Astro generará tamaños responsivos con rutas ligadas a la compilación bajo `/MediPoli/`.

Anclar la capa decorativa a la ventana y colocarla detrás de todo el cuerpo de la portada. Dar contraste a los textos con una capa de color y el pie translúcido. En móviles, tomar como altura mínima la ventana con la barra del navegador retraída para estabilizar el encuadre durante el desplazamiento. La foto permanece estática con ambas preferencias de movimiento.

Comprobar la portada y la agenda con una compilación local antes de la validación en GitHub. Publicar la portada y sus activos en el ambiente de desarrollo con CodeBuild a partir del commit validado. La publicación reemplaza el HTML de inicio, conserva su versión anterior en S3 e invalida las rutas de la portada en CloudFront.
