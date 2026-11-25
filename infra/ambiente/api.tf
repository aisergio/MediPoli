resource "aws_cloudwatch_log_group" "api" {
  count             = local.app
  name              = "/aws/lambda/${local.api_name}"
  retention_in_days = 7
}

resource "aws_iam_role" "api" {
  count = local.app
  name  = "${local.api_name}-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "api" {
  count = local.app
  name  = "AgendaYAltas"
  role  = aws_iam_role.api[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api[0].arn}:*" },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:ConditionCheckItem"]
        Resource = [module.data.agenda_arn, "${module.data.agenda_arn}/index/*"]
      },
      { Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser"], Resource = aws_cognito_user_pool.portal[0].arn }
    ]
  })
}

resource "aws_lambda_function" "api" {
  count            = local.app
  function_name    = local.api_name
  filename         = local.api_zip
  source_code_hash = try(filebase64sha256(local.api_zip), null)
  role             = aws_iam_role.api[0].arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  publish          = true
  memory_size      = 256
  timeout          = 15
  environment {
    variables = {
      AGENDA_TABLE        = module.data.agenda_name
      USER_POOL_ID        = aws_cognito_user_pool.portal[0].id
      PUBLIC_ORIGIN       = local.public_origin
      OAUTH_ISSUER        = "https://${aws_cognito_user_pool.portal[0].endpoint}"
      WEB_SCOPE           = local.web_scope
      MCP_CLIENT_ID       = try(aws_cognito_user_pool_client.mcp[0].id, "")
      MCP_PUBLIC_ORIGIN   = local.mcp_public_origin
      MCP_ALLOWED_ORIGINS = "${local.public_origin},https://chatgpt.com,http://127.0.0.1:6274,http://localhost:6274"
    }
  }
  depends_on = [aws_iam_role_policy.api]
  lifecycle {
    # El release modifica el paquete y los alias. Terraform administra los recursos.
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_alias" "live" {
  count            = local.app
  name             = "live"
  function_name    = aws_lambda_function.api[0].function_name
  function_version = aws_lambda_function.api[0].version
  lifecycle { ignore_changes = [function_version, routing_config] }
}

resource "aws_lambda_alias" "candidate" {
  count            = local.app
  name             = "candidate"
  function_name    = aws_lambda_function.api[0].function_name
  function_version = aws_lambda_function.api[0].version
  lifecycle { ignore_changes = [function_version] }
}

resource "aws_apigatewayv2_api" "portal" {
  count         = local.app
  name          = local.prefix
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "web" {
  count            = local.app
  api_id           = aws_apigatewayv2_api.portal[0].id
  name             = "cognito-web"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.web[0].id]
    issuer   = "https://${aws_cognito_user_pool.portal[0].endpoint}"
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = var.enable_application ? toset(["live", "candidate"]) : toset([])
  api_id                 = aws_apigatewayv2_api.portal[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.key == "live" ? aws_lambda_alias.live[0].invoke_arn : aws_lambda_alias.candidate[0].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 18000
}

resource "aws_apigatewayv2_route" "public" {
  for_each = var.enable_application ? toset([
    "GET /MediPoli/api/health",
    "GET /MediPoli/api/candidate-health",
    "GET /.well-known/oauth-protected-resource/MediPoli/mcp",
    "ANY /MediPoli/mcp"
  ]) : toset([])
  api_id    = aws_apigatewayv2_api.portal[0].id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.lambda[endswith(each.key, "/candidate-health") ? "candidate" : "live"].id}"
}

resource "aws_apigatewayv2_route" "protected" {
  count                = local.app
  api_id               = aws_apigatewayv2_api.portal[0].id
  route_key            = "ANY /MediPoli/api/{proxy+}"
  target               = "integrations/${aws_apigatewayv2_integration.lambda["live"].id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.web[0].id
  authorization_scopes = [local.web_scope]
}

resource "aws_lambda_permission" "api_gateway" {
  for_each      = var.enable_application ? toset(["live", "candidate"]) : toset([])
  statement_id  = "ApiGateway-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[0].function_name
  qualifier     = each.key
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.portal[0].execution_arn}/*/*"
  depends_on    = [aws_lambda_alias.live, aws_lambda_alias.candidate]
}

resource "aws_cloudwatch_log_group" "gateway" {
  count             = local.app
  name              = "/aws/apigateway/${local.prefix}"
  retention_in_days = 7
}

resource "aws_apigatewayv2_stage" "portal" {
  count       = local.app
  api_id      = aws_apigatewayv2_api.portal[0].id
  name        = "$default"
  auto_deploy = true
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway[0].arn
    format = jsonencode({
      requestId = "$context.requestId",
      route     = "$context.routeKey",
      status    = "$context.status",
      latency   = "$context.responseLatency"
    })
  }
  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 8
  }
}

output "application" {
  value = var.enable_application ? {
    site_origin       = local.public_origin
    cognito_domain    = local.cognito_host
    web_client_id     = aws_cognito_user_pool_client.web[0].id
    mcp_client_id     = try(aws_cognito_user_pool_client.mcp[0].id, null)
    user_pool_id      = aws_cognito_user_pool.portal[0].id
    web_scope         = local.web_scope
    api_domain        = aws_apigatewayv2_api.portal[0].api_endpoint
    cloudfront_domain = aws_cloudfront_distribution.portal[0].domain_name
    cloudfront_id     = aws_cloudfront_distribution.portal[0].id
    site_bucket       = aws_s3_bucket.site[0].id
    failure_bucket    = aws_s3_bucket.failure[0].id
    github_role_arn   = try(aws_iam_role.github[0].arn, null)
  } : null
}
