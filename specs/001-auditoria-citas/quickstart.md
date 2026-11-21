# MP-09 · Cómo reproducir la verificación

Ejecutar desde la raíz de MediPoli. Registrar la revisión con `git rev-parse HEAD` y la hora UTC. La suite local funciona sin credenciales de AWS.

```powershell
node --test --test-name-pattern=P-09 pruebas/integracion.test.mjs pruebas/auditoria.test.mjs
node --test pruebas/*.test.mjs
```

## Ensayo en AWS dev

1. Seleccionar el perfil `medipoli` y la región del proyecto. Tomar el ID esperado de la configuración privada del proyecto. Compararlo con la identidad de STS. Consultar el estado de la función y del mapeo. Para el ensayo se necesitan una función activa, un mapeo habilitado y un destino S3 para los fallos.

   ```powershell
   $env:AWS_PROFILE = 'medipoli'
   $env:MEDIPOLI_ENV = 'dev'
   $config = Get-Content -Raw .work/laboratorio.auto.tfvars.json | ConvertFrom-Json
   $env:AWS_REGION = $config.region
   $env:AWS_EXPECTED_ACCOUNT = [string]$config.account_id
   $actual = aws sts get-caller-identity --query Account --output text
   if ($LASTEXITCODE -ne 0 -or $actual -ne $env:AWS_EXPECTED_ACCOUNT) { throw 'Verificar la sesión de MediPoli.' }
   aws lambda get-function-configuration --function-name medipoli-dev-auditoria --query State
   aws lambda list-event-source-mappings --function-name medipoli-dev-auditoria --query 'EventSourceMappings[].{estado:State,reintentos:MaximumRetryAttempts,destino:DestinationConfig.OnFailure.Destination}'
   ```

2. Con un paciente de demostración, reservar, reprogramar y cancelar la misma cita. Conservar el identificador sintético y las tres solicitudes. Consultar las claves `EVENT#<cita>#1`, `#2` y `#3` en `medipoli-dev-auditoria` con lectura consistente. Comprobar tipo, sede, servicio, revisión y correlación. Se esperan tres filas.
3. En una prueba de fallo controlado en dev, seleccionar una cita sintética exclusiva del ensayo. Una forma de aislar el fallo consiste en restringir temporalmente la escritura del consumidor **solo** para la clave de auditoría de esa cita y revisión. Conservar la regla previa, comprobar el alcance exacto y retirar la restricción al terminar, incluso si el ensayo falla. Observar los reintentos y esperar a que el mapeo escriba el objeto en su destino. Registrar que otra cita continúa auditándose. Si no se obtiene un objeto emitido por el mapeo, el ensayo de entrega a S3 queda pendiente.
4. Después de corregir la causa, copiar la clave exacta del objeto desde el bucket privado del ambiente. Asignarla a `$clave` en PowerShell y ejecutar el comando siguiente dos veces. La salida de cada ejecución debe indicar `ok` y el número de registros. Una salida con error deja el lote pendiente de investigación. El comando conserva el objeto en S3.

   ```powershell
   node scripts/reprocesar-evento.mjs "$clave"
   if ($LASTEXITCODE -ne 0) { throw 'El lote todavía tiene errores.' }
   ```

5. Volver a leer las claves de ambas citas. Comparar las entradas y sus correlaciones antes y después del segundo reproceso. Conservar en la carpeta privada el objeto original y las consultas. Para el informe publicar solo revisión, fecha, ambiente, número de entradas, reintentos observados y resultado.

Si falta la función o el mapeo, registrar el requisito de despliegue y reanudar desde el paso 1 cuando esté disponible la infraestructura de U3. [Diseño y diagrama](plan.md) · [Criterios y avance](tasks.md)
