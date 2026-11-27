# Plan de publicación gradual con CodeBuild

1. Ejecutar CodeBuild con la revisión exacta de la solicitud de revisión y seleccionar el modo `canary` para el ensayo. La configuración habitual de desarrollo permite seguir usando `directo-dev`.
2. Crear una sesión temporal para un paciente ficticio. CodeBuild obtiene su token desde un parámetro cifrado de Systems Manager con un permiso limitado a ese parámetro. Validar la consulta autenticada antes de ajustar el alias.
3. Publicar una versión de Lambda e identificarla con la revisión incluida en el paquete. Verificar la candidata, asignarle un peso de 0,10 en el alias `live` y muestrear la disponibilidad durante cinco minutos. Medir las respuestas de cada versión y aplicar los umbrales de U4-C02.
4. Ejecutar un segundo despliegue con un paquete de ensayo que genera HTTP 503 exclusivamente para la identidad sintética en la consulta de disponibilidad. Comprobar la retirada de la ponderación, la salud de la versión estable y la restitución de la configuración de la candidata.
5. Asociar el resultado al código y al registro de cada ejecución. Retirar el parámetro y las identidades temporales verificadas.

[Alias ponderados de Lambda](https://docs.aws.amazon.com/lambda/latest/dg/configuring-alias-routing.html) · [Parámetros de CodeBuild](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html)
