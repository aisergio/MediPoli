# MP-09 · Cómo reproducir la verificación

Ejecutar desde la raíz de MediPoli. Registrar la revisión con `git rev-parse HEAD` y la hora UTC. La suite local funciona sin credenciales de AWS.

```powershell
node --test --test-name-pattern=P-09 pruebas/integracion.test.mjs pruebas/auditoria.test.mjs
node --test pruebas/*.test.mjs
```

## Ensayo en AWS dev

La base de U2 puede ampliarse con `enable_audit=true` y `enable_application=false` en el estado `dev/base.tfstate`. Empaquetar Lambda con `node scripts/empaquetar.mjs`, ejecutar el plan de Terraform en `infra/ambiente` y revisar que sus cambios correspondan a Streams, el consumidor, su rol, el grupo de logs y el bucket privado. Mientras el ensayo sea la única parte desplegada de U3, conservar `enable_audit=true` al planear dev. `enable_application=true` habilita la auditoría cuando se incorpore la aplicación completa. [Variables de Terraform](../../infra/ambiente/variables.tf)

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

El perfil que ejecuta la prueba consulta la función, el mapeo y la tabla de auditoría. También necesita acceso al bucket privado, a CloudWatch Logs, a los elementos sintéticos de DynamoDB y a una política en línea del rol de auditoría de `dev`. El script comprueba en el simulador IAM que la denegación afecta solo a la clave esperada. Una invocación de prueba a Lambda usa un marcador temporal en esa misma clave para verificar que el permiso se propagó antes de generar el evento real. El marcador se retira antes de escribir en la agenda.

La regla tiene caducidad de quince minutos. El script la retira antes de reprocesar y espera hasta cuatro minutos si Lambda aún devuelve fallos. Al finalizar retira las dos filas sintéticas de origen. Las filas de auditoría y el objeto en S3 quedan disponibles para revisar el resultado. [Propagación de cambios de IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html#troubleshoot_general_eventual-consistency)

La ejecución deja `resultado.json` y el objeto de fallo en `evidencia/privada/mp09-…/`. `estado: verificado` requiere el historial de control, el objeto de S3, el fallo repetido en CloudWatch y ambos reprocesos. Confirmar que `limpiezaPendiente` esté vacío. El manifiesto registra el commit de la prueba y el hash de código de la función desplegada.

Si vence la espera de la sonda, el ensayo queda inconcluso y retira el marcador y la política de prueba. Si el mapeo ya archivó el lote y vence la espera de recuperación, `resultado.json` conserva `archivo.key`. Después de verificar el retiro de la política, usar esa clave en el paso 4 y comprobar el resultado del paso 5. Así se reanuda la recuperación del mismo evento.

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
