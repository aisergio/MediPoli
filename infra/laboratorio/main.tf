terraform {
  required_version = ">= 1.14.3, < 2.0"
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

variable "account_id" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "public_subnets" { type = list(string) }
variable "private_subnets" { type = list(string) }
variable "lambda_security_group" { type = string }
variable "agenda_name" { type = string }
variable "agenda_arn" { type = string }
variable "test_cidr" {
  description = "IPv4 de la estación de pruebas con máscara /32."
  type        = string
  validation {
    condition     = can(cidrnetmask(var.test_cidr)) && endswith(var.test_cidr, "/32")
    error_message = "La prueba solo permite una dirección IPv4 /32."
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { Project = "MediPoli", Environment = "dev", Purpose = "Laboratorio-U2", ManagedBy = "Terraform" }
  }
}

locals {
  name = "medipoli-u2-red"
}

resource "aws_dynamodb_table_item" "sample" {
  table_name = var.agenda_name
  hash_key   = "pk"
  item = jsonencode({
    pk    = { S = "LAB#STATUS" }
    value = { S = "medipoli-u2" }
  })
}

resource "aws_cloudwatch_log_group" "function" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = 7
}

resource "aws_iam_role" "function" {
  name = "${local.name}-lambda"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "function" {
  name = "leer-registro-y-escribir-logs"
  role = aws_iam_role.function.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow", Action = "dynamodb:GetItem", Resource = var.agenda_arn
        Condition = { "ForAllValues:StringEquals" = { "dynamodb:LeadingKeys" = ["LAB#STATUS"] } }
      },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.function.arn}:*" },
      {
        Effect = "Allow", Resource = "*"
        Action = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
      }
    ]
  })
}

data "archive_file" "function" {
  type        = "zip"
  source_file = "${path.module}/index.mjs"
  output_path = "${path.module}/laboratorio.zip"
}

resource "aws_lambda_function" "function" {
  function_name    = local.name
  filename         = data.archive_file.function.output_path
  source_code_hash = data.archive_file.function.output_base64sha256
  role             = aws_iam_role.function.arn
  handler          = "index.handler"
  runtime          = "nodejs22.x"
  timeout          = 8
  memory_size      = 128
  environment {
    variables = { TABLE_NAME = var.agenda_name }
  }
  vpc_config {
    subnet_ids         = var.private_subnets
    security_group_ids = [var.lambda_security_group]
  }
  depends_on = [aws_iam_role_policy.function, aws_dynamodb_table_item.sample]
}

resource "aws_security_group" "alb" {
  name        = local.name
  description = "HTTP desde la estacion de validacion"
  vpc_id      = var.vpc_id
  ingress {
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = [var.test_cidr]
  }
}

resource "aws_lb" "lab" {
  name               = local.name
  internal           = false
  load_balancer_type = "application"
  subnets            = var.public_subnets
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "lambda" {
  name        = local.name
  target_type = "lambda"
}

resource "aws_lambda_permission" "alb" {
  statement_id   = "MediPoliLaboratorioALB"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.function.function_name
  principal      = "elasticloadbalancing.amazonaws.com"
  source_arn     = aws_lb_target_group.lambda.arn
  source_account = var.account_id
}

resource "aws_lb_target_group_attachment" "lambda" {
  target_group_arn = aws_lb_target_group.lambda.arn
  target_id        = aws_lambda_function.function.arn
  depends_on       = [aws_lambda_permission.alb]
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.lab.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.lambda.arn
  }
}

output "test_url" {
  value = "http://${aws_lb.lab.dns_name}/health"
}
