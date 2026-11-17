[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$Cuenta,
  [string]$Region = 'us-east-2',
  [string]$Perfil = 'medipoli',
  [ValidateSet('dev', 'prod')][string]$Ambiente = 'dev',
  [string]$Terraform = 'terraform',
  [switch]$Aplicar,
  [switch]$LimiteConfirmado,
  [switch]$PlanGratuito,
  [switch]$PresupuestoExistente,
  [switch]$Aplicacion
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$work = Join-Path $project '.work'
New-Item -ItemType Directory -Path $work -Force | Out-Null
if ($Aplicar -and !$LimiteConfirmado -and !$PlanGratuito) {
  throw 'Para aplicar, indica -LimiteConfirmado en Paid o -PlanGratuito para la base dev de U2.'
}
if ($Aplicar -and $Ambiente -eq 'dev' -and !$PresupuestoExistente -and [string]::IsNullOrWhiteSpace($env:TF_VAR_budget_email)) {
  throw 'Define TF_VAR_budget_email en la sesión antes de aplicar dev.'
}
$actual = & aws sts get-caller-identity --profile $Perfil --region $Region --query Account --output text --no-cli-pager
if ($LASTEXITCODE -ne 0 -or $actual.Trim() -ne $Cuenta) {
  throw 'La sesión AWS no corresponde a la cuenta del proyecto MediPoli indicada.'
}
if ($PlanGratuito) {
  $tipo = & aws freetier get-account-plan-state --profile $Perfil --region us-east-1 --query accountPlanType --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or $tipo.Trim() -ne 'FREE' -or $Ambiente -ne 'dev' -or $Aplicacion) {
    throw 'El modo Free de U2 solo aprovisiona la base dev de un proyecto en plan Free.'
  }
}

function Invoke-Terraform {
  param([string]$Directory, [string[]]$Arguments, [int[]]$Allow = @(0))
  & $Terraform "-chdir=$Directory" @Arguments
  if ($LASTEXITCODE -notin $Allow) { throw "Terraform devolvió $LASTEXITCODE ejecutando $($Arguments[0])." }
}

$priorProfile = $env:AWS_PROFILE
$priorData = $env:TF_DATA_DIR
$priorBudget = $env:TF_VAR_budget_email
try {
  $env:AWS_PROFILE = $Perfil
  if ($PresupuestoExistente) { $env:TF_VAR_budget_email = $null }
  $bootstrap = Join-Path $project 'infra/bootstrap'
  $directory = Join-Path $project 'infra/ambiente'
  $parameters = @("-var=account_id=$Cuenta", "-var=region=$Region")
  $bucket = "medipoli-state-$Cuenta-$Region"
  if ($Aplicar) {
    $env:TF_DATA_DIR = Join-Path $work 'terraform-bootstrap'
    Invoke-Terraform $bootstrap @('init', '-input=false')
    $bootstrapPlan = Join-Path $work 'bootstrap.tfplan'
    Invoke-Terraform $bootstrap (@('plan', '-input=false', "-out=$bootstrapPlan") + $parameters)
    Invoke-Terraform $bootstrap @('apply', '-input=false', $bootstrapPlan)
  }
  $env:TF_DATA_DIR = Join-Path $work "terraform-$Ambiente"
  Invoke-Terraform $directory @('init', '-input=false', '-reconfigure', "-backend-config=bucket=$bucket", "-backend-config=key=$Ambiente/base.tfstate", "-backend-config=region=$Region")
  $plan = Join-Path $work "$Ambiente.tfplan"
  $parameters += @("-var=environment=$Ambiente", "-var=enable_application=$($Aplicacion.IsPresent.ToString().ToLowerInvariant())")
  Invoke-Terraform $directory (@('plan', '-input=false', "-out=$plan") + $parameters)
  if ($Aplicar) {
    Invoke-Terraform $directory @('apply', '-input=false', $plan)
    Invoke-Terraform $directory (@('plan', '-input=false', '-detailed-exitcode') + $parameters)
    $record = @{
      checkedAtUtc = [DateTime]::UtcNow.ToString('o')
      stage        = $Ambiente
      terraform    = ((& $Terraform version -json | ConvertFrom-Json).terraform_version)
      evidence     = 'El segundo plan regresó código 0: sin cambios.'
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work "$Ambiente-segundo-plan.json") -Encoding utf8
  }
} finally {
  $env:AWS_PROFILE = $priorProfile
  $env:TF_DATA_DIR = $priorData
  $env:TF_VAR_budget_email = $priorBudget
}
