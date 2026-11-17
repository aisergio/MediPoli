resource "aws_s3_bucket" "site" {
  count  = local.app
  bucket = local.site_bucket
}

resource "aws_s3_bucket" "failure" {
  count  = local.app
  bucket = local.failure_bucket
}

resource "aws_s3_bucket_public_access_block" "private" {
  for_each = var.enable_application ? {
    site    = aws_s3_bucket.site[0].id
    failure = aws_s3_bucket.failure[0].id
  } : {}
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "site" {
  count  = local.app
  bucket = aws_s3_bucket.site[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "failure" {
  count  = local.app
  bucket = aws_s3_bucket.failure[0].id
  rule {
    id     = "EventosFallidosTreintaDias"
    status = "Enabled"
    filter {}
    expiration { days = 30 }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  count  = local.app
  bucket = aws_s3_bucket.site[0].id
  rule {
    id     = "VersionesAnteriores"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 30 }
  }
  depends_on = [aws_s3_bucket_versioning.site]
}

resource "aws_cloudfront_origin_access_control" "site" {
  count                             = local.app
  name                              = local.prefix
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "index" {
  count   = local.app
  name    = "${local.prefix}-index"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/index-cf.js")
}

data "aws_cloudfront_cache_policy" "optimized" {
  count = local.app
  name  = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  count = local.app
  name  = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "gateway" {
  count = local.app
  name  = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_response_headers_policy" "security" {
  count = local.app
  name  = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "portal" {
  count               = local.app
  enabled             = true
  comment             = local.prefix
  is_ipv6_enabled     = true
  price_class         = "PriceClass_100"
  wait_for_deployment = false
  default_root_object = "MediPoli/index.html"
  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.site[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site[0].id
  }
  origin {
    origin_id   = "api"
    domain_name = trimprefix(aws_apigatewayv2_api.portal[0].api_endpoint, "https://")
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  default_cache_behavior {
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized[0].id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security[0].id
    compress                   = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index[0].arn
    }
  }
  dynamic "ordered_cache_behavior" {
    for_each = ["/MediPoli/api/*", "/MediPoli/mcp", "/.well-known/oauth-protected-resource/MediPoli/mcp"]
    content {
      path_pattern             = ordered_cache_behavior.value
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      target_origin_id         = "api"
      viewer_protocol_policy   = "https-only"
      cache_policy_id          = data.aws_cloudfront_cache_policy.disabled[0].id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.gateway[0].id
    }
  }
  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_s3_bucket_policy" "site" {
  count  = local.app
  bucket = aws_s3_bucket.site[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "LecturaSoloDesdeCloudFront"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site[0].arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.portal[0].arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.private]
}
