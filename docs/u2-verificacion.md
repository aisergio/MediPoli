# Verificación de la infraestructura base

## 1. Identificar el proyecto

Abra [AWS Settings](https://settings.aws.com), localice MediPoli y compruebe nombre, región, ID y funciones avanzadas desactivadas. Tome una captura donde se vean el proyecto y el estado, ocultando el ID completo y la información de facturación ajena al trabajo. Para el límite nativo de USD 50 se requiere el plan Paid; el cambio de plan y la activación de funciones avanzadas son controles distintos.

U2 conserva **Free** en MediPoli. En Presupuestos, compruebe el presupuesto mensual de USD 50 y los avisos por correo al 60 %, 80 % y 100 % del coste observado. El presupuesto se deja sin acción IAM. La pausa integral a USD 50 se configura mediante un límite nativo en AWS Settings bajo Paid.

## 2. Validar antes de usar credenciales

```powershell
terraform fmt -recursive -check infra
terraform -chdir=infra/bootstrap init -backend=false
terraform -chdir=infra/bootstrap validate
terraform -chdir=infra/ambiente init -backend=false
terraform -chdir=infra/ambiente validate
terraform -chdir=infra/laboratorio init -backend=false
terraform -chdir=infra/laboratorio validate
```

Conserve versión de Terraform, entorno, fecha UTC, commit y resultado. Estas validaciones no consultan recursos creados.

## 3. Aprovisionar y comprobar idempotencia

Use un perfil temporal del proyecto MediPoli. Este ejemplo conserva el presupuesto existente en la consola y verifica el plan Free antes de aplicar.

```powershell
.\scripts\base-aws.ps1 -Cuenta $idMediPoli -Region $regionMediPoli -Aplicar -PlanGratuito -PresupuestoExistente
```

El script verifica la identidad AWS, crea el bucket de estado protegido, aplica la base `dev` y genera un segundo plan. El resultado esperado del segundo plan es código 0. Si devuelve 2, lea qué cambió y corríjalo antes de repetir. Si devuelve 1, compruebe el error de acceso o de configuración. La evidencia resumida se guarda en `.work/dev-segundo-plan.json`; el plan completo y el estado se conservan de forma privada.

## 4. Comprobar ALB, Lambda y DynamoDB

En la estación de pruebas, identifique su IPv4 pública y prepare la forma `IP/32`. Antes de ejecutar, confirme que es una estación autorizada y con salida a AWS. El balanceador permite solo dicha dirección y usa datos sintéticos.

```powershell
.\scripts\prueba-red.ps1 -Cuenta $idMediPoli -Region $regionMediPoli -Cidr $cidrPrueba -PlanGratuito
```

El resultado esperado es HTTP 200 y `ok: true` con `prueba: ALB-Lambda-DynamoDB`. Busque el mismo ID de solicitud en CloudWatch. El script retira los recursos del laboratorio al terminar, también si falla la consulta. Si el proceso se interrumpe, ejecute enseguida la variante `-SoloRetirar` con los mismos parámetros y confirme que el balanceador se eliminó. El estado de la VPC y de la tabla base queda separado del laboratorio.

## 5. Publicar la evidencia

Anote la fecha UTC, el commit, el ambiente y el resultado verificable. Oculte los IDs de cuenta, la IP, las direcciones de correo, las credenciales y los detalles ajenos al curso. La comprobación del límite nativo se hace por configuración. Un resultado local se registra como validación local y una prueba sin ejecutar se registra como pendiente.
