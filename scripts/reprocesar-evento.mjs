import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aws, assertAccount } from "./aws-cli.mjs";

function parseJson(text, errorMessage) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(errorMessage);
  }
}

function readStreamEvent(archive) {
  const invalid = "No se encontró un lote DynamoDB válido.";
  const envelope = parseJson(archive, invalid);
  const payload = envelope?.payload ?? envelope?.requestPayload;
  const event = typeof payload === "string" ? parseJson(payload, invalid) : payload;
  if (!Array.isArray(event?.Records) || event.Records.length === 0) throw new Error(invalid);
  for (const record of event.Records) {
    const sequence = record?.dynamodb?.SequenceNumber;
    if (record?.eventSource !== "aws:dynamodb" || typeof sequence !== "string" || sequence.length === 0) {
      throw new Error(invalid);
    }
  }
  return event;
}

export async function replayFailedBatch({ key, stage, account }, { run = aws, checkAccount = assertAccount } = {}) {
  const prefix = "aws/lambda/";
  if (!["dev", "prod"].includes(stage) || typeof key !== "string" ||
    !key.startsWith(prefix) || key.length === prefix.length || /[\r\n]/.test(key)) {
    throw new Error("Use la clave del evento fallido generada por Lambda en el bucket de MediPoli.");
  }
  await checkAccount(account);
  const directory = await mkdtemp(join(tmpdir(), "medipoli-evento-"));
  const source = join(directory, "failure.json");
  const input = join(directory, "invoke.json");
  const output = join(directory, "result.json");
  try {
    await run(["s3api", "get-object", "--bucket", `medipoli-${stage}-fallos-${account}`,
      "--expected-bucket-owner", account, "--key", key, source]);
    const event = readStreamEvent(await readFile(source, "utf8"));
    await writeFile(input, JSON.stringify(event), { mode: 0o600 });
    const result = await run(["lambda", "invoke", "--function-name", `medipoli-${stage}-auditoria`, "--payload", "fileb://" + input, output]);
    if (result?.StatusCode !== 200 || result.FunctionError) throw new Error("Falló la invocación del consumidor.");
    const response = parseJson(await readFile(output, "utf8"), "La respuesta del consumidor es ilegible.");
    if (!Array.isArray(response?.batchItemFailures)) throw new Error("Falta la confirmación de los registros.");
    if (response.batchItemFailures.length > 0) throw new Error("Persisten registros fallidos.");
    return { ok: true, records: event.Records.length, environment: stage, utc: new Date().toISOString() };
  } finally {
    for (const file of [source, input, output]) await rm(file, { force: true });
    await rmdir(directory);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const summary = await replayFailedBatch({
    key: process.argv[2], stage: process.env.MEDIPOLI_ENV, account: process.env.AWS_EXPECTED_ACCOUNT
  });
  console.log(JSON.stringify(summary));
}
