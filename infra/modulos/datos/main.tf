variable "name" { type = string }
variable "enable_stream" { type = bool }
variable "deletion_protection" { type = bool }

resource "aws_dynamodb_table" "agenda" {
  name                        = "${var.name}-agenda"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  stream_enabled              = var.enable_stream
  stream_view_type            = var.enable_stream ? "NEW_IMAGE" : null
  deletion_protection_enabled = var.deletion_protection

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "patient"
    type = "S"
  }
  attribute {
    name = "professional"
    type = "S"
  }
  attribute {
    name = "starts"
    type = "S"
  }
  attribute {
    name = "availability"
    type = "S"
  }
  global_secondary_index {
    name            = "por-paciente"
    hash_key        = "patient"
    range_key       = "starts"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "por-profesional"
    hash_key        = "professional"
    range_key       = "starts"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "por-disponibilidad"
    hash_key        = "availability"
    range_key       = "starts"
    projection_type = "ALL"
  }
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
}

resource "aws_dynamodb_table" "audit" {
  name                        = "${var.name}-auditoria"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  deletion_protection_enabled = var.deletion_protection
  attribute {
    name = "pk"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
}

output "agenda_name" { value = aws_dynamodb_table.agenda.name }
output "agenda_arn" { value = aws_dynamodb_table.agenda.arn }
output "stream_arn" { value = aws_dynamodb_table.agenda.stream_arn }
output "audit_name" { value = aws_dynamodb_table.audit.name }
output "audit_arn" { value = aws_dynamodb_table.audit.arn }
