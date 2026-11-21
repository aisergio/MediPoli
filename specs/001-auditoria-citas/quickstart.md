# MP-09 · Cómo reproducir la verificación

Ejecutar desde la raíz de MediPoli. Registrar la revisión con `git rev-parse HEAD` y la hora UTC. La suite local funciona sin credenciales de AWS.

```powershell
node --test --test-name-pattern=P-09 pruebas/integracion.test.mjs pruebas/auditoria.test.mjs
node --test pruebas/*.test.mjs
```

## Ensayo en AWS dev

### Ejecución automatizada de DynamoDB Streams a S3

Ejecutar con el perfil `medipoli` cuando la función, el mapeo y el bucket de fallos estén desplegados. El primer comando comprueba la cuenta y lee la configuración. El segundo escribe dos citas sintéticas directamente en la tabla de agenda. Una recorre las tres revisiones. En la otra se provoca un fallo de escritura en una sola clave y se espera el objeto que publica el mapeo. El script retira la política, reprocesa dos veces ese objeto y verifica las filas de auditoría.

```powershell
$config = Get-Content -Raw .work/laboratorio.auto.tfvars.json | ConvertFrom-Json
$env:AWS_PROFILE = 'medipoli'
$env:AWS_REGION = $config.region
$env:AWS_EXPECTED_ACCOUNT = [string]$config.account_id
$env:MEDIPOLI_ENV = 'dev'
node scripts/ensayar-auditoria-dev.mjs --comprobar
if ($LASTEXITCODE -ne 0) { throw 'Revisar la sesión y la infraestructura de dev.' }
node scripts/ensayar-auditoria-dev.mjs --ejecutar
if ($LASTEXITCODE -ne 0) { throw 'Revisar el estado y la limpieza en la evidencia privada.' }
```

El perfil que ejecuta la prueba consulta la función, el mapeo y la tabla de auditoría. También necesita acceso al bucket privado, a CloudWatch Logs, a los elementos de prueba de la agenda y a una política en línea del rol de auditoría de `dev`. El script comprueba en el simulador IAM que la denegación afecta solo a la clave esperada. La regla tiene caducidad de diez minutos y el script la retira junto con las dos filas de origen al finalizar. Las filas de auditoría y el objeto en S3 quedan disponibles para revisar el resultado.

La ejecución deja `resultado.json` y el objeto de fallo en `evidencia/privada/mp09-…/`. `estado: verificado` requiere el historial de control, el objeto de S3, el fallo repetido en CloudWatch y ambos reprocesos. Confirmar que `limpiezaPendiente` esté vacío. El manifiesto registra el commit de la prueba y el hash de código de la función desplegada.

### Evidencia paso a paso

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

   ```powershell
   $cita = Read-Host 'Identificador de la cita sintética'
   $movimientos = @('CitaReservada', 'CitaReprogramada', 'CitaCancelada')
   foreach ($revision in 1..3) {
       $claveFila = "pk={S=EVENT#$cita#$revision}"
       $salida = aws dynamodb get-item --table-name medipoli-dev-auditoria --consistent-read --key $claveFila --query 'Item.{revision:revision.N,movimiento:type.S,solicitud:requestId.S,fecha:changedAt.S,sede:clinic.S,servicio:service.S}' --output json
       if ($LASTEXITCODE -ne 0) { throw 'Falló la lectura de la tabla de auditoría.' }
       $fila = $salida | ConvertFrom-Json
       if (!$fila -or [int]$fila.revision -ne $revision -or $fila.movimiento -ne $movimientos[$revision - 1] -or !$fila.solicitud) {
           throw "La revisión $revision aún no presenta el historial esperado."
       }
       $fila
   }
   ```

3. En una prueba de fallo controlado en dev, seleccionar una cita sintética exclusiva del ensayo. Una forma de aislar el fallo consiste en restringir temporalmente la escritura del consumidor **solo** para la clave de auditoría de esa cita y revisión. Conservar la regla previa, comprobar el alcance exacto y retirar la restricción al terminar, incluso si el ensayo falla. Observar los reintentos y esperar a que el mapeo escriba el objeto en su destino. Registrar que otra cita continúa auditándose. Si no se obtiene un objeto emitido por el mapeo, el ensayo de entrega a S3 queda pendiente.
4. Después de corregir la causa, copiar la clave exacta del objeto desde el bucket privado del ambiente. Asignarla a `$clave` en PowerShell y ejecutar el comando siguiente dos veces. La salida de cada ejecución debe indicar `ok` y el número de registros. Una salida con error deja el lote pendiente de investigación. El comando conserva el objeto en S3.

   ```powershell
   $clave = Read-Host 'Clave del objeto emitido para el ensayo, comenzando por aws/lambda/'
   node scripts/reprocesar-evento.mjs "$clave"
   if ($LASTEXITCODE -ne 0) { throw 'El lote todavía tiene errores.' }
   ```

5. Volver a leer las claves de ambas citas. Comparar las entradas y sus correlaciones antes y después del segundo reproceso. Conservar en la carpeta privada el objeto original y las consultas. Para el informe publicar solo revisión, fecha, ambiente, número de entradas, reintentos observados y resultado.

Si falta la función o el mapeo, registrar el requisito de despliegue y reanudar desde el paso 1 cuando esté disponible la infraestructura de U3. [Diseño y diagrama](plan.md) · [Criterios y avance](tasks.md)
