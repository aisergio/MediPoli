# Publicación gradual de MediPoli en desarrollo

Como responsable de la entrega U4, quiero comprobar que una versión candidata de la agenda puede recibir una parte del tráfico, superar una evaluación cuantitativa y tomar el tráfico completo. También quiero observar una reversión automática cuando una versión candidata falla para un usuario sintético.

| Criterio | Comprobación observable |
|---|---|
| U4-C01 · Preparación | La revisión compila, pasa las verificaciones y la candidata responde con una versión propia antes de recibir tráfico público. La consulta autenticada de disponibilidad funciona con la versión estable. |
| U4-C02 · Promoción | La candidata recibe un peso de 10 % durante al menos cinco minutos. Se atribuyen las respuestas a cada versión y se promueve con cien o más muestras candidatas, hasta 1 % de errores técnicos y p95 de consulta de hasta dos segundos. |
| U4-C03 · Reversión | Un fallo HTTP 503 de la candidata afecta únicamente a las consultas de disponibilidad del paciente sintético del ensayo. La evaluación rechaza la promoción y se verifican la versión estable y la retirada del peso adicional. Con muestras insuficientes, el ensayo queda inconcluso y se retira el peso. |
| U4-C04 · Evidencia y acceso | Cada ensayo registra revisión, ejecución, versiones, peso, tiempo, muestras, errores y latencias p95/p99. Se verifica la limpieza de los datos de prueba y del token temporal. |

La demostración del fallo se realiza en desarrollo. Tanto la publicación como la reversión usan datos sintéticos. La aprobación de producción sigue el proceso de revisión del proyecto.
