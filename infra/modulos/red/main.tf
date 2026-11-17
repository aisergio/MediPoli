variable "name" { type = string }
variable "region" { type = string }
variable "cidr" { type = string }

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  # Cuatro subredes: una pública y una privada por cada zona.
  zones = slice(sort(data.aws_availability_zones.available.names), 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = var.cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = var.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = var.name }
}

resource "aws_subnet" "public" {
  for_each                = toset(local.zones)
  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.value
  cidr_block              = cidrsubnet(var.cidr, 8, index(local.zones, each.key))
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.name}-public-${each.key}" }
}

resource "aws_subnet" "private" {
  for_each          = toset(local.zones)
  vpc_id            = aws_vpc.main.id
  availability_zone = each.value
  cidr_block        = cidrsubnet(var.cidr, 8, 16 + index(local.zones, each.key))
  tags              = { Name = "${var.name}-private-${each.key}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${var.name}-public" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.name}-private" }
  # No hay ruta por defecto. Los endpoints gateway añaden las rutas de S3 y DynamoDB.
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  for_each       = aws_subnet.private
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

resource "aws_vpc_endpoint" "gateway" {
  for_each          = toset(["s3", "dynamodb"])
  vpc_id            = aws_vpc.main.id
  vpc_endpoint_type = "Gateway"
  service_name      = "com.amazonaws.${var.region}.${each.value}"
  route_table_ids   = [aws_route_table.private.id]
}

resource "aws_security_group" "private_lambda" {
  name        = "${var.name}-private-lambda"
  description = "Lambda sin ingress con salida TLS hacia endpoints gateway"
  vpc_id      = aws_vpc.main.id
  egress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    prefix_list_ids = [for endpoint in aws_vpc_endpoint.gateway : endpoint.prefix_list_id]
  }
}

output "vpc_id" { value = aws_vpc.main.id }
output "public_subnets" { value = [for subnet in aws_subnet.public : subnet.id] }
output "private_subnets" { value = [for subnet in aws_subnet.private : subnet.id] }
output "lambda_security_group" { value = aws_security_group.private_lambda.id }
