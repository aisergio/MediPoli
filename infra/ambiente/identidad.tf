locals {
  app             = var.enable_application ? 1 : 0
  api_name        = "${local.prefix}-api"
  audit_name      = "${local.prefix}-auditoria"
  public_origin   = var.enable_application && var.environment == "dev" ? "https://${aws_cloudfront_distribution.portal[0].domain_name}" : var.site_origin
  web_resource    = "${local.public_origin}/MediPoli/api"
  mcp_resource    = "${local.public_origin}/MediPoli/mcp"
  web_scope       = "${local.web_resource}/agenda"
  mcp_enabled     = var.enable_application && length(var.mcp_callback_urls) > 0 ? 1 : 0
  auth_domain     = "${local.prefix}-${var.account_id}"
  api_zip         = "${path.module}/../../.work/build/api.zip"
  audit_zip       = "${path.module}/../../.work/build/auditoria.zip"
  site_bucket     = "${local.prefix}-web-${var.account_id}"
  failure_bucket  = "${local.prefix}-fallos-${var.account_id}"
  cognito_host    = "${local.auth_domain}.auth.${var.region}.amazoncognito.com"
  callback        = "${local.public_origin}/MediPoli/agenda/"
  web_return_urls = var.environment == "dev" ? distinct([local.callback, "http://localhost:4321/MediPoli/agenda/", "${var.site_origin}/MediPoli/agenda/"]) : [local.callback]
  role_enabled    = var.enable_application && var.github_oidc_provider_arn != null && var.github_oidc_subject != null ? 1 : 0
}

resource "aws_cognito_user_pool" "portal" {
  count               = local.app
  name                = local.prefix
  user_pool_tier      = "ESSENTIALS"
  deletion_protection = var.environment == "prod" ? "ACTIVE" : "INACTIVE"
  admin_create_user_config { allow_admin_create_user_only = true }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 2
  }
  username_configuration { case_sensitive = false }
}

resource "aws_cognito_user_pool_domain" "portal" {
  count                 = local.app
  domain                = local.auth_domain
  user_pool_id          = aws_cognito_user_pool.portal[0].id
  managed_login_version = 2
}

resource "aws_cognito_resource_server" "web" {
  count        = local.app
  identifier   = local.web_resource
  name         = "Agenda MediPoli web"
  user_pool_id = aws_cognito_user_pool.portal[0].id
  scope {
    scope_name        = "agenda"
    scope_description = "Acceder a la agenda según el perfil de MediPoli"
  }
}

resource "aws_cognito_resource_server" "mcp" {
  count        = local.mcp_enabled
  identifier   = local.mcp_resource
  name         = "Agenda MediPoli MCP"
  user_pool_id = aws_cognito_user_pool.portal[0].id
  scope {
    scope_name        = "read"
    scope_description = "Consultar disponibilidad y citas propias"
  }
  scope {
    scope_name        = "reserve"
    scope_description = "Reservar una cita propia confirmada"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  count                                = local.app
  name                                 = "${local.prefix}-web"
  user_pool_id                         = aws_cognito_user_pool.portal[0].id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", local.web_scope]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = local.web_return_urls
  logout_urls                          = local.web_return_urls
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  access_token_validity                = 30
  id_token_validity                    = 30
  refresh_token_validity               = 1
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
  depends_on = [aws_cognito_resource_server.web]
}

resource "aws_cognito_user_pool_client" "mcp" {
  count                                = local.mcp_enabled
  name                                 = "${local.prefix}-mcp"
  user_pool_id                         = aws_cognito_user_pool.portal[0].id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "${local.mcp_resource}/read", "${local.mcp_resource}/reserve"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = var.mcp_callback_urls
  prevent_user_existence_errors        = "ENABLED"
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  depends_on                           = [aws_cognito_resource_server.mcp]
}

resource "aws_cognito_managed_login_branding" "web" {
  count                       = local.app
  user_pool_id                = aws_cognito_user_pool.portal[0].id
  client_id                   = aws_cognito_user_pool_client.web[0].id
  use_cognito_provided_values = true
}

resource "aws_cognito_managed_login_branding" "mcp" {
  count                       = local.mcp_enabled
  user_pool_id                = aws_cognito_user_pool.portal[0].id
  client_id                   = aws_cognito_user_pool_client.mcp[0].id
  use_cognito_provided_values = true
}

resource "aws_iam_role" "github" {
  count = local.role_enabled
  name  = "${local.prefix}-github-release"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = var.github_oidc_provider_arn }
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = var.github_oidc_subject
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github" {
  count  = local.role_enabled
  name   = "PublicarVersionesYObjetos"
  role   = aws_iam_role.github[0].id
  policy = local.release_policy
}
