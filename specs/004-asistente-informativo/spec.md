# Asistente de información institucional

Una persona con sesión activa en la agenda puede elegir una pregunta sobre las sedes o los servicios de MediPoli y leer una respuesta breve en español. La fuente de los datos es el catálogo ficticio de la IPS.

| Criterio | Ejemplo de aceptación |
|---|---|
| IA-01 Acceso | Una sesión válida con perfil de MediPoli puede consultar el asistente en desarrollo. Una solicitud sin sesión recibe un rechazo. |
| IA-02 Sedes y servicios | La consulta de sedes informa los nombres y sectores del catálogo. La consulta de servicios informa medicina general y odontología. |
| IA-03 Origen de la respuesta | El resultado indica si la consulta fue asistida por IA o resuelta por el respaldo del catálogo. El portal compone el texto con datos del catálogo en ambos casos. |
| IA-04 Control de uso | Después de 100 consultas al modelo en el mismo día de Bogotá, las siguientes entregan el catálogo. Las consultas concurrentes comparten ese límite. |

Las entradas del asistente son dos preguntas predefinidas. Los datos que recibe el modelo se limitan al catálogo institucional. La respuesta muestra solo el conjunto completo de referencias válidas para la consulta.
