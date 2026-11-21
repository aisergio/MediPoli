import { mkdtemp, readFile, writeFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aws, assertAccount } from "./aws-cli.mjs";

export async function replayFailedBatch({ key, stage, account }, { run = aws, checkAccount = assertAccount } = {}) {
  if (!["dev", "prod"].includes(stage) || !/^aws\/lambda\/[^\r\n]+\.json$/.test(key ?? "")) {
    throw new Error("Use la clave del evento fallido generada por Lambda en el bucket de MediPoli.");
  }
  await checkAccount(account);
  const directory = await mkdtemp(join(tmpdir(), "medipoli-evento-"));
  const source = join(directory, "failure.json");
  const input = join(directory, "invoke.json");
  const output = join(directory, "result.json");
  try {
    await run(["s3api", "get-object", "--bucket", `medipoli-${stage}-fallos-${account}`, "--key", key, source]);
    const envelope = JSON.parse(await readFile(source, "utf8"));
    const event = typeof envelope.requestPayload === "string" ? JSON.parse(envelope.requestPayload) : envelope.requestPayload;
    if (!event || !Array.isArray(event.Records) || event.Records.length === 0 ||
      event.Records.some(record => record.eventSource !== "aws:dynamodb")) throw new Error("No se encontró un lote DynamoDB válido.");
    await writeFile(input, JSON.stringify(event), { mode: 0o600 });
    const result = await run(["lambda", "invoke", "--function-name", `medipoli-${stage}-auditoria`, "--payload", "fileb://" + input, output]);
    const response = JSON.parse(await readFile(output, "utf8"));
    if (result.FunctionError || response.batchItemFailures?.length) throw new Error("Persisten registros fallidos.");
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
