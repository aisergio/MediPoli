resource "aws_cloudwatch_log_group" "audit" {
  count             = local.app
  name              = "/aws/lambda/${local.audit_name}"
  retention_in_days = 7
}

resource "aws_iam_role" "audit" {
  count = local.app
  name  = "${local.audit_name}-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "audit" {
  count = local.app
  name  = "StreamsAuditoriaYFallos"
  role  = aws_iam_role.audit[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.audit[0].arn}:*" },
      { Effect = "Allow", Action = ["dynamodb:DescribeStream", "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ListStreams"], Resource = module.data.stream_arn },
      { Effect = "Allow", Action = "dynamodb:PutItem", Resource = module.data.audit_arn },
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.failure[0].arn },
      {
        Effect    = "Allow", Action = "s3:PutObject", Resource = "${aws_s3_bucket.failure[0].arn}/*"
        Condition = { StringEquals = { "s3:ResourceAccount" = var.account_id } }
      },
      {
        Effect   = "Allow"
        Resource = "*"
        Action   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
      }
    ]
  })
}

resource "aws_lambda_function" "audit" {
  count            = local.app
  function_name    = local.audit_name
  filename         = local.audit_zip
  source_code_hash = try(filebase64sha256(local.audit_zip), null)
  role             = aws_iam_role.audit[0].arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  memory_size      = 256
  timeout          = 12
  vpc_config {
    subnet_ids         = module.network.private_subnets
    security_group_ids = [module.network.lambda_security_group]
  }
  environment { variables = { AUDIT_TABLE = module.data.audit_name } }
  depends_on = [aws_iam_role_policy.audit]
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

resource "aws_lambda_event_source_mapping" "audit" {
  count                          = local.app
  event_source_arn               = module.data.stream_arn
  function_name                  = aws_lambda_function.audit[0].arn
  starting_position              = "TRIM_HORIZON"
  batch_size                     = 10
  parallelization_factor         = 1
  maximum_record_age_in_seconds  = 3600
  maximum_retry_attempts         = 2
  function_response_types        = ["ReportBatchItemFailures"]
  bisect_batch_on_function_error = true
  filter_criteria {
    filter {
      pattern = jsonencode({ eventName = ["INSERT", "MODIFY"], dynamodb = { NewImage = { entity = { S = ["APPOINTMENT"] } } } })
    }
  }
  destination_config {
    on_failure { destination_arn = aws_s3_bucket.failure[0].arn }
  }
}
