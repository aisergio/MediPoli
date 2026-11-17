[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{12}$')][string]$Cuenta,
  [Parameter(Mandatory)][ValidatePattern('^([0-9]{1,3}\.){3}[0-9]{1,3}/32$')][string]$Cidr,
  [string]$Region = 'us-east-2',
  [string]$Perfil = 'medipoli',
  [string]$Terraform = 'terraform',
  [switch]$LimiteConfirmado,
  [switch]$PlanGratuito,
  [switch]$SoloRetirar
)

$ErrorActionPreference = 'Stop'
if (!$LimiteConfirmado -and !$PlanGratuito -and !$SoloRetirar) { throw 'Verifica el límite nativo de USD 50 o confirma el plan Free del proyecto.' }
$actual = & aws sts get-caller-identity --profile $Perfil --region $Region --query Account --output text --no-cli-pager
if ($LASTEXITCODE -ne 0 -or $actual.Trim() -ne $Cuenta) { throw 'La cuenta de AWS no corresponde a MediPoli.' }
if ($PlanGratuito) {
  $tipo = & aws freetier get-account-plan-state --profile $Perfil --region us-east-1 --query accountPlanType --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0 -or $tipo.Trim() -ne 'FREE') { throw 'El plan Free no está activo.' }
}
$root = Split-Path $PSScriptRoot -Parent
$work = Join-Path $root '.work'
$base = Join-Path $root 'infra/ambiente'
$lab = Join-Path $root 'infra/laboratorio'
$bucket = "medipoli-state-$Cuenta-$Region"
$inputs = Join-Path $work 'laboratorio.auto.tfvars.json'

function Invoke-Terraform {
  param([string]$Directory, [string[]]$Arguments)
  & $Terraform "-chdir=$Directory" @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Terraform devolvió $LASTEXITCODE al ejecutar $($Arguments[0])." }
}

$priorProfile = $env:AWS_PROFILE
$priorData = $env:TF_DATA_DIR
try {
  $env:AWS_PROFILE = $Perfil
  $env:TF_DATA_DIR = Join-Path $work 'terraform-dev'
  if (!$SoloRetirar -or !(Test-Path -LiteralPath $inputs)) {
    $outputs = Invoke-Terraform $base @('output', '-json') | ConvertFrom-Json
    @{
      account_id = $Cuenta
      region = $Region
      test_cidr = $Cidr
      vpc_id = $outputs.network.value.vpc_id
      public_subnets = $outputs.network.value.public_subnets
      private_subnets = $outputs.network.value.private_subnets
      lambda_security_group = $outputs.network.value.lambda_security_group
      agenda_name = $outputs.agenda_name.value
      agenda_arn = $outputs.agenda_arn.value
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $inputs -Encoding utf8
  }
  $env:TF_DATA_DIR = Join-Path $work 'terraform-laboratorio'
  Invoke-Terraform $lab @('init', '-input=false', '-reconfigure', "-backend-config=bucket=$bucket", '-backend-config=key=dev/laboratorio.tfstate', "-backend-config=region=$Region")
  if ($SoloRetirar) {
    Invoke-Terraform $lab @('destroy', '-auto-approve', '-input=false', "-var-file=$inputs")
    return
  }
  try {
    Invoke-Terraform $lab @('apply', '-auto-approve', '-input=false', "-var-file=$inputs")
    $endpoint = Invoke-Terraform $lab @('output', '-raw', 'test_url')
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    do {
      try { $check = Invoke-RestMethod -Uri $endpoint -TimeoutSec 8 }
      catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Seconds 8 }
    } until ($check)
    if (!$check.ok -or $check.prueba -ne 'ALB-Lambda-DynamoDB') { throw 'La respuesta no verifica la lectura de DynamoDB.' }
    $check | Add-Member -NotePropertyName checkedAtUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o'))
    $check | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work 'u2-prueba-red.json') -Encoding utf8
  } finally {
    Invoke-Terraform $lab @('destroy', '-auto-approve', '-input=false', "-var-file=$inputs")
  }
} finally {
  $env:AWS_PROFILE = $priorProfile
  $env:TF_DATA_DIR = $priorData
}
