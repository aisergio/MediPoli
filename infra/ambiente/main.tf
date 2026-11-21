locals {
  prefix       = "medipoli-${var.environment}"
  audit_active = var.enable_application || var.enable_audit
}

module "network" {
  source = "../modulos/red"

  name   = local.prefix
  region = var.region
  cidr   = var.environment == "dev" ? "10.30.0.0/16" : "10.40.0.0/16"
}

module "data" {
  source = "../modulos/datos"

  name                = local.prefix
  enable_stream       = local.audit_active
  deletion_protection = var.environment == "prod"
}

resource "aws_budgets_budget" "project" {
  # Los ambientes comparten una cuenta de proyecto. El presupuesto se administra desde dev.
  count        = var.environment == "dev" && nonsensitive(var.budget_email != null) ? 1 : 0
  name         = "MediPoli mensual"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
    include_tax    = false
  }

  dynamic "notification" {
    for_each = toset([60, 80])
    content {
      notification_type          = "ACTUAL"
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = [var.budget_email]
    }
  }
}

output "network" {
  value = {
    vpc_id                = module.network.vpc_id
    public_subnets        = module.network.public_subnets
    private_subnets       = module.network.private_subnets
    lambda_security_group = module.network.lambda_security_group
  }
}

output "agenda_name" {
  value = module.data.agenda_name
}

output "agenda_arn" {
  value = module.data.agenda_arn
}
