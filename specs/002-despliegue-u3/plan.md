# Unidad 3 · Plan de despliegue y verificación

## Integración con la infraestructura existente

Se conserva el estado remoto de Terraform de `dev`, la tabla de agenda de U2 y el flujo de auditoría MP-09. La configuración de la aplicación añade el sitio Astro en un bucket privado, CloudFront como entrada HTTPS, un grupo de usuarios Cognito y API Gateway HTTP con funciones Lambda. En `dev` se deriva el origen público del dominio nativo de CloudFront. El callback de la web y los identificadores de recursos OAuth se calculan desde ese mismo origen. Así se puede verificar la aplicación en su ambiente de desarrollo con una dirección HTTPS propia. [Arquitectura U3](../../diagramas/u3/01-arquitectura.mmd) · [Pruebas de resiliencia MP-09](../001-auditoria-citas/tasks.md)

La web usa autorización de código con PKCE S256. API Gateway valida el emisor, el cliente y el permiso de agenda. Lambda aplica el rol y la titularidad del registro. La ruta MCP verifica, además, que el token esté destinado al recurso exacto. Para ensayar ese flujo se registra un callback de prueba en el equipo local. [Código de autorización en Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html) · [Recorrido de MCP](../../diagramas/u3/06-mcp.mmd)

## Evidencia esperada de la rúbrica

| Criterio | Peso | Evidencia prevista |
| --- | ---: | --- |
| Flujo serverless | 40 | Portal HTTPS, API, operación de cita y registro en la misma tabla de agenda extendida desde U2. |
| Eventos y resiliencia | 40 | Prueba MP-09 del lote real archivado, recuperación y duplicado. La operación de agenda añade evidencia del origen normal del evento. |
| Seguridad, escalabilidad y rendimiento | 40 | Acceso por rol y titularidad, origen S3 privado, límites de API y latencia de una prueba acotada. La estimación de costos explica sus supuestos. |
| Observabilidad | 15 | Una correlación real entre API, función y auditoría. Métricas y los primeros indicadores de disponibilidad, latencia y demora del consumidor. |
| Reflexión técnica | 15 | Comparación con la base de U2 y con un servicio tradicional. Análisis de arranque en frío, dependencia de servicios y costos variables. |

## Secuencia de trabajo

1. Revisar un plan de Terraform del proyecto en `dev`. Comprobar que sea aditivo sobre el estado actual y conservar el plan Free.
2. Publicar el portal e inicializar los perfiles ficticios. Comprobar la API pública y el rechazo de una ruta autenticada sin token.
3. Probar el flujo web, los límites de cada rol y el cliente MCP con sesión temporal. Correlacionar una cita con su auditoría y guardar resultados saneados.
4. Contrastar la evidencia con los cinco criterios y preparar el insumo del informe de 15 a 20 páginas para el Escenario 5. [Diagrama de observación](../../diagramas/u3/07-observabilidad.mmd)
