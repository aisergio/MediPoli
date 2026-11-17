resource "aws_cloudwatch_metric_alarm" "api_latency" {
  count               = local.app
  alarm_name          = "${local.prefix}-latencia-p95"
  alarm_description   = "p95 superior a dos segundos en dos periodos"
  namespace           = "AWS/ApiGateway"
  metric_name         = "Latency"
  extended_statistic  = "p95"
  period              = 60
  evaluation_periods  = 2
  threshold           = 2000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  dimensions          = { ApiId = aws_apigatewayv2_api.portal[0].id, Stage = "$default" }
}

resource "aws_cloudwatch_metric_alarm" "stream_age" {
  count               = local.app
  alarm_name          = "${local.prefix}-atraso-stream"
  alarm_description   = "Auditoría por detrás de la escritura de citas"
  namespace           = "AWS/Lambda"
  metric_name         = "IteratorAge"
  statistic           = "Maximum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 60000
  period              = 60
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  dimensions          = { FunctionName = aws_lambda_function.audit[0].function_name }
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  count               = local.app
  alarm_name          = "${local.prefix}-errores-api"
  alarm_description   = "Errores de servidor en la API"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 1
  period              = 60
  evaluation_periods  = 2
  treat_missing_data  = "notBreaching"
  dimensions          = { ApiId = aws_apigatewayv2_api.portal[0].id, Stage = "$default" }
}

resource "aws_cloudwatch_dashboard" "portal" {
  count          = local.app
  dashboard_name = local.prefix
  dashboard_body = jsonencode({
    widgets = [
      { type = "metric", x = 0, y = 0, width = 12, height = 6,
        properties = { title = "Latencia API", region = var.region, period = 60, metrics = [
          ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.portal[0].id, "Stage", "$default", { stat = "p95" }],
          ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.portal[0].id, "Stage", "$default", { stat = "p99" }]
      ] } },
      { type = "metric", x = 12, y = 0, width = 12, height = 6,
        properties = { title = "Solicitudes y errores", region = var.region, period = 60, stat = "Sum", metrics = [
          ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.portal[0].id, "Stage", "$default"],
          ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.portal[0].id, "Stage", "$default"]
      ] } },
      { type = "metric", x = 0, y = 6, width = 12, height = 6,
        properties = { title = "Atraso de auditoría", region = var.region, period = 60, stat = "Maximum", metrics = [
          ["AWS/Lambda", "IteratorAge", "FunctionName", aws_lambda_function.audit[0].function_name]
      ] } }
    ]
  })
}
