import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aws, assertAccount } from "./aws-cli.mjs";

const [key] = process.argv.slice(2);
const stage = process.env.MEDIPOLI_ENV;
const id = process.env.AWS_EXPECTED_ACCOUNT;
if (!["dev", "prod"].includes(stage) || !/^aws\/lambda\/[^\r\n]+\.json$/.test(key ?? "")) {
  throw new Error("Use la clave del evento fallido generada por Lambda en el bucket de MediPoli.");
}
assertAccount(id);
const cwd = await mkdtemp(join(tmpdir(), "medipoli-evento-"));
try {
  const source = join(cwd, "failure.json");
  const input = join(cwd, "invoke.json");
  const output = join(cwd, "result.json");
  aws(["s3api", "get-object", "--bucket", `medipoli-${stage}-fallos-${id}`, "--key", key, source]);
  const envelope = JSON.parse(await readFile(source, "utf8"));
  const event = typeof envelope.requestPayload === "string" ? JSON.parse(envelope.requestPayload) : envelope.requestPayload;
  if (!event || !Array.isArray(event.Records) || event.Records.length === 0 ||
    event.Records.some(record => record.eventSource !== "aws:dynamodb")) throw new Error("No se encontró un lote DynamoDB válido.");
  await writeFile(input, JSON.stringify(event), { mode: 0o600 });
  const result = aws(["lambda", "invoke", "--function-name", `medipoli-${stage}-auditoria`, "--payload", "fileb://" + input, output]);
  const response = JSON.parse(await readFile(output, "utf8"));
  if (result.FunctionError || response.batchItemFailures?.length) throw new Error("Persisten registros fallidos.");
  console.log(JSON.stringify({ ok: true, records: event.Records.length, environment: stage, utc: new Date().toISOString() }));
} finally {
  for (const name of ["failure.json", "invoke.json", "result.json"]) await rm(join(cwd, name), { force: true });
}
