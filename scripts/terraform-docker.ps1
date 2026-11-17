# Ejecuta Terraform en Docker cuando el proveedor no se inicia en Windows.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Split-Path $PSScriptRoot -Parent)).Path
$cache = Join-Path $project '.work/tf-providers'
New-Item -ItemType Directory -Path $cache -Force | Out-Null

function Convert-ContainerPath {
  param([string]$Value)
  $marker = $Value.IndexOf($project, [StringComparison]::OrdinalIgnoreCase)
  if ($marker -ge 0) {
    return ($Value.Substring(0,$marker) + '/workspace' + $Value.Substring($marker + $project.Length)).Replace('\','/')
  }
  return $Value
}

$converted = @($args | ForEach-Object { Convert-ContainerPath $_ })
$dockerEnv = @('-e', 'TF_IN_AUTOMATION=1', '-e', 'TF_PLUGIN_CACHE_DIR=/workspace/.work/tf-providers')
if ($env:TF_DATA_DIR) { $dockerEnv += @('-e', "TF_DATA_DIR=$(Convert-ContainerPath $env:TF_DATA_DIR)") }
foreach($name in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','TF_VAR_budget_email')) {
  if ([Environment]::GetEnvironmentVariable($name)) { $dockerEnv += @('-e', $name) }
}
& docker run --rm --cap-drop ALL --security-opt no-new-privileges @dockerEnv --mount "type=bind,source=$project\infra,target=/workspace/infra" --mount "type=bind,source=$project\.work,target=/workspace/.work" --workdir /workspace 'hashicorp/terraform:1.14.3@sha256:20056ea0d2706f2a944e202befa8a558dbcc5798da0b64f884b2647aab82a4ef' @converted
exit $LASTEXITCODE
