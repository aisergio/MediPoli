locals {
  release_policy = var.enable_application ? templatefile("${path.module}/politica-publicacion.json.tftpl", {
    api_arn          = aws_lambda_function.api[0].arn
    audit_arn        = aws_lambda_function.audit[0].arn
    site_arn         = aws_s3_bucket.site[0].arn
    distribution_arn = aws_cloudfront_distribution.portal[0].arn
  }) : null
}

resource "aws_iam_role_policy" "codebuild" {
  count  = var.codebuild_release_role_name == null ? 0 : 1
  name   = "PublicarVersionesYObjetos"
  role   = var.codebuild_release_role_name
  policy = local.release_policy
}
