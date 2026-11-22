variable "account_id" {
  description = "ID del proyecto MediPoli, verificado en AWS Settings."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "El ID de AWS debe contener doce dígitos."
  }
}

variable "region" {
  description = "Región asignada al proyecto en AWS Settings."
  type        = string
  default     = "us-east-2"
}

variable "environment" {
  description = "Ambiente del proyecto. Use una clave de estado distinta para cada uno."
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "El ambiente debe ser dev o prod."
  }
}

variable "budget_email" {
  description = "Destinatario privado de las alertas AWS Budget."
  type        = string
  sensitive   = true
  default     = null
  validation {
    condition     = var.budget_email == null ? true : can(regex("^[^@ ]+@[^@ ]+[.][^@ ]+$", var.budget_email))
    error_message = "La dirección de notificación debe ser un correo válido."
  }
}

variable "enable_application" {
  description = "Habilita Cognito, API, Streams y publicación de U3."
  type        = bool
  default     = false
}

variable "enable_audit" {
  description = "Activa en dev el flujo de auditoría antes de publicar la aplicación completa."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_audit || var.environment == "dev"
    error_message = "El aprovisionamiento independiente de auditoría se limita a dev."
  }
}

variable "site_origin" {
  description = "Origen público de producción sin barra final. El ambiente dev usa su dominio de CloudFront."
  type        = string
  default     = "https://aisergio.dev"
}

variable "mcp_callback_urls" {
  description = "Callbacks OAuth exactos proporcionados por los clientes MCP autorizados."
  type        = list(string)
  default     = []
}

variable "github_oidc_provider_arn" {
  description = "Proveedor federado de GitHub existente o creado mediante el bootstrap de identidad."
  type        = string
  default     = null
}

variable "github_oidc_subject" {
  description = "Sujeto exacto del entorno GitHub, incluidos sus ID inmutables cuando correspondan."
  type        = string
  default     = null
  validation {
    condition = var.github_oidc_subject == null ? true : (
      !strcontains(var.github_oidc_subject, "*") &&
      !strcontains(var.github_oidc_subject, "?") &&
      startswith(var.github_oidc_subject, "repo:aisergio")
    )
    error_message = "Proporcione el sujeto exacto de aisergio sin comodines."
  }
}
