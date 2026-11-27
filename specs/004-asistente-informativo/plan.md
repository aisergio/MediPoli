# Implementación del asistente

1. Agregar dos consultas a la agenda autenticada. La API informa en el perfil si el asistente está habilitado.
2. Elegir la pregunta en el servidor a partir de un identificador del catálogo. Invocar GPT-OSS 20B con Chat Completions de Bedrock Mantle en Ohio y firma AWS con el rol de Lambda.
3. Reservar cada intento con un contador condicional de DynamoDB. La clave corresponde al día de Bogotá y el TTL retira los contadores antiguos.
4. Limitar cada salida a 192 tokens. Validar los identificadores devueltos por el modelo y formar el texto con los nombres y sectores del catálogo. Si falla la solicitud o la selección es inválida, mostrar el catálogo como fuente.
5. Agregar permisos de Bedrock y del contador solo al rol de la API de desarrollo. Revisar el plan de Terraform antes del despliegue.
6. Publicar en desarrollo con CodeBuild desde una revisión identificada. Comprobar el acceso y la respuesta en el portal.

La prueba anterior de Mantle acreditó la respuesta de GPT-OSS 20B desde una Lambda temporal. La verificación de esta mejora usa la ruta autenticada de la agenda.
