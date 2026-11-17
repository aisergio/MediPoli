import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";

const source = (name) => readFile(name, "utf8");
const terraform = (await readdir("infra", { recursive: true })).filter(name => name.endsWith(".tf"));
const files = await Promise.all(terraform.map(name => source("infra/" + name)));
for (const [index, text] of files.entries()) {
  assert.doesNotMatch(text, /"iam:\*"|"iam:PassRole"|"organizations:\*"|skip_credentials_validation\s*=\s*true/i, terraform[index]);
  assert.doesNotMatch(text, /resource\s+"aws_nat_gateway"/, terraform[index]);
}
for (const root of ["bootstrap", "ambiente", "laboratorio"]) {
  const text = files.filter((_, index) => terraform[index].replaceAll("\\", "/").startsWith(root + "/")).join("\n");
  assert.match(text, /allowed_account_ids\s*=\s*\[var\.account_id\]/, root);
}
for (const folder of ["ambiente", "laboratorio"]) {
  const text = files.filter((_, index) => terraform[index].replaceAll("\\", "/").startsWith(folder + "/")).join("\n");
  assert.match(text, /use_lockfile\s*=\s*true/, folder);
}
const web = await source("infra/ambiente/publicacion.tf");
for (const control of ["block_public_acls", "block_public_policy", "ignore_public_acls", "restrict_public_buckets"]) {
  assert.match(web, new RegExp(control + "\\s*=\\s*true"));
}
assert.match(web, /Managed-CachingDisabled/);
assert.match(web, /"AWS:SourceArn"\s*=\s*aws_cloudfront_distribution\.portal/);
const github = await source("infra/ambiente/identidad.tf");
assert.match(github, /"token\.actions\.githubusercontent\.com:sub"\s*=\s*var\.github_oidc_subject/);
assert.match(github, /"token\.actions\.githubusercontent\.com:aud"\s*=\s*"sts\.amazonaws\.com"/);
const laboratory = await source("infra/laboratorio/main.tf");
assert.match(laboratory, /endswith\(var\.test_cidr, "\/32"\)/);
assert.match(laboratory, /"dynamodb:LeadingKeys"\s*=\s*\["LAB#STATUS"\]/);
console.log(JSON.stringify({ ok: true, check: "Controles de código para cuenta, estado, red, S3, OIDC y permisos.", hclFiles: files.length }));
