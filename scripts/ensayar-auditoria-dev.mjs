import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { assertAccount, aws } from "./aws-cli.mjs";
import { replayFailedBatch } from "./reprocesar-evento.mjs";

const [mode, extra] = process.argv.slice(2);
const account = process.env.AWS_EXPECTED_ACCOUNT;
const region = process.env.AWS_REGION;
const stage = process.env.MEDIPOLI_ENV;
assert(stage === "dev" && region, "Define MEDIPOLI_ENV=dev, AWS_REGION y la cuenta esperada de MediPoli.");
assert(!extra && ["--comprobar", "--ejecutar"].includes(mode), "Usa --comprobar o --ejecutar.");
assertAccount(account);

const agendaTable = "medipoli-dev-agenda";
const audit = "medipoli-dev-auditoria";
const bucket = `medipoli-dev-fallos-${account}`;
const role = audit + "-lambda";
const roleArn = `arn:aws:iam::${account}:role/${role}`;
const auditArn = `arn:aws:dynamodb:${region}:${account}:table/${audit}`;
const call = args => aws([...args, "--region", region, "--cli-connect-timeout", "5", "--cli-read-timeout", "15"]);

const fn = call(["lambda", "get-function-configuration", "--function-name", audit, "--query",
  "{arn:FunctionArn,state:State,role:Role,table:Environment.Variables.AUDIT_TABLE,hash:CodeSha256}"]);
assert(fn?.state === "Active" && fn.role === roleArn && fn.table === audit &&
  fn.arn === `arn:aws:lambda:${region}:${account}:function:${audit}`, "Verifica la función de auditoría de dev y su rol.");
const streamArn = call(["dynamodb", "describe-table", "--table-name", agendaTable, "--query", "Table.LatestStreamArn"]);
assert(streamArn?.startsWith(`arn:aws:dynamodb:${region}:${account}:table/${agendaTable}/stream/`), "La agenda de dev necesita Streams.");
const [mapping, ...otherMappings] = call(["lambda", "list-event-source-mappings", "--function-name", audit,
  "--event-source-arn", streamArn, "--query", "EventSourceMappings"]);
assert(mapping?.State === "Enabled" && otherMappings.length === 0 && mapping.MaximumRetryAttempts === 2 &&
  mapping.FunctionResponseTypes?.includes("ReportBatchItemFailures") &&
  mapping.DestinationConfig?.OnFailure?.Destination === `arn:aws:s3:::${bucket}`, "Verifica el mapeo, los dos reintentos y el destino S3 de dev.");
const owner = ["--expected-bucket-owner", account];
const publicAccess = call(["s3api", "get-public-access-block", "--bucket", bucket, ...owner]).PublicAccessBlockConfiguration;
assert(["BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"]
  .every(setting => publicAccess?.[setting] === true), "El destino S3 debe tener habilitados los cuatro bloqueos de acceso público.");
const environment = { stage, region, reintentosConfigurados: mapping.MaximumRetryAttempts, sha256LambdaBase64: fn.hash };
console.log(JSON.stringify({ comprobacion: "Lambda, Streams y S3", ...environment }));

if (mode === "--ejecutar") await rehearse();

async function waitFor(read, seconds, reason, intervalMs = 2500) {
  const until = Date.now() + seconds * 1000;
  do {
    const data = await read();
    if (data) return data;
    await sleep(intervalMs);
  } while (Date.now() < until);
  throw new Error(reason);
}

async function rehearse() {
  const started = Date.now();
  const run = randomUUID();
  const normal = "mp09-normal-" + run;
  const failing = "mp09-fallo-" + run;
  const failedKey = `EVENT#${failing}#1`;
  const dir = join("evidencia", "privada", "mp09-" + run);
  await mkdir(dir, { recursive: true });
  const evidence = {
    ...environment, run, utc: new Date(started).toISOString(), estado: "inconcluso",
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  };
  const policyName = "MediPoliMP09-" + run;
  const rolePolicy = ["--role-name", role, "--policy-name", policyName];
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  const expiryTtl = Math.floor(started / 1000) + 86400;
  const originKeys = new Set();
  let policyAttempted = false;

  function readAudit(id, revision) {
    const { Item } = call(["dynamodb", "get-item", "--table-name", audit, "--consistent-read",
      "--key", JSON.stringify(marshall({ pk: `EVENT#${id}#${revision}` }))]);
    return Item && unmarshall(Item);
  }

  function sendChange(id, revision, type, status) {
    const changedAt = new Date().toISOString();
    const requestId = `solicitud-${id}-${revision}`;
    const clinic = "centro";
    const service = "odontologia";
    const pk = "APT#" + id;
    const item = { pk, id, revision, entity: "APPOINTMENT", eventType: type, status, changedAt,
      requestId, clinic, service, patient: "paciente-ficticio-" + run, demoRun: run, expiresAt: expiryTtl };
    const condition = revision === 1 ? ["--condition-expression", "attribute_not_exists(pk)"] : [
      "--condition-expression", "demoRun = :run AND revision = :prev",
      "--expression-attribute-values", JSON.stringify(marshall({ ":run": run, ":prev": revision - 1 }))
    ];
    originKeys.add(pk);
    call(["dynamodb", "put-item", "--table-name", agendaTable, "--item", JSON.stringify(marshall(item)), ...condition]);
    const eventId = `${id}#${revision}`;
    return { pk: "EVENT#" + eventId, entity: "AUDIT", eventId, type, appointmentId: id, revision, changedAt, clinic, service, requestId };
  }

  function decision(key) {
    const context = [
      { ContextKeyName: "dynamodb:LeadingKeys", ContextKeyValues: [key], ContextKeyType: "stringList" },
      { ContextKeyName: "aws:CurrentTime", ContextKeyValues: [new Date().toISOString()], ContextKeyType: "date" },
      { ContextKeyName: "aws:PrincipalAccount", ContextKeyValues: [account], ContextKeyType: "string" },
      { ContextKeyName: "aws:ResourceAccount", ContextKeyValues: [account], ContextKeyType: "string" },
      { ContextKeyName: "aws:RequestedRegion", ContextKeyValues: [region], ContextKeyType: "string" }
    ];
    return call(["iam", "simulate-principal-policy", "--policy-source-arn", roleArn, "--action-names", "dynamodb:PutItem",
      "--resource-arns", auditArn, "--context-entries", JSON.stringify(context), "--query", "EvaluationResults[0].EvalDecision"]);
  }

  async function findArchive() {
    const checked = new Set();
    const temporary = join(dir, "candidato.json");
    try {
      return await waitFor(async () => {
        const objects = call(["s3api", "list-objects-v2", "--bucket", bucket, ...owner,
          "--prefix", `aws/lambda/${mapping.UUID}/`, "--query", "Contents[]"]);
        for (const { Key, LastModified } of objects ?? []) {
          if (checked.has(Key) || Date.parse(LastModified) < Math.floor(started / 1000) * 1000) continue;
          checked.add(Key);
          call(["s3api", "get-object", "--bucket", bucket, ...owner, "--key", Key, temporary]);
          const raw = await readFile(temporary, "utf8");
          const envelope = JSON.parse(raw);
          const records = typeof envelope.payload === "string" && JSON.parse(envelope.payload).Records;
          if (!Array.isArray(records)) continue;
          const failed = records.find(record => record.dynamodb?.NewImage?.id?.S === failing);
          if (!failed) continue;
          assert(records.every(record => record.dynamodb?.NewImage?.demoRun?.S === run),
            "El lote también contiene cambios ajenos al ensayo.");
          assert(typeof failed.eventID === "string" && failed.eventID, "Falta el identificador del cambio archivado.");
          assert.equal(envelope.DDBStreamBatchInfo.streamArn, streamArn);
          assert.equal(envelope.requestContext.condition, "RetryAttemptsExhausted");
          await writeFile(join(dir, "fallo-s3.json"), raw, { mode: 0o600 });
          return { key: Key, eventId: failed.eventID, payloadRecords: records.length };
        }
      }, 210, "El mapeo todavía no entregó el fallo a S3.");
    } finally {
      await rm(temporary, { force: true });
    }
  }

  function removePolicy() {
    try {
      call(["iam", "delete-role-policy", ...rolePolicy]);
    } catch (error) {
      if (!error.message.includes("NoSuchEntity")) throw error;
    }
    policyAttempted = false;
    evidence.politicaRetirada = true;
  }

  try {
    const policy = { Version: "2012-10-17", Statement: [{
      Effect: "Deny", Action: "dynamodb:PutItem", Resource: auditArn,
      Condition: { "ForAllValues:StringEquals": { "dynamodb:LeadingKeys": [failedKey] },
        Null: { "dynamodb:LeadingKeys": "false" }, DateLessThan: { "aws:CurrentTime": expires } }
    }] };
    const policyPath = join(dir, "restriccion-temporal.json");
    await writeFile(policyPath, JSON.stringify(policy, null, 2), { mode: 0o600 });
    evidence.expiracionPoliticaUtc = expires;
    assert(!(call(["iam", "list-role-policies", "--role-name", role]).PolicyNames ?? []).includes(policyName),
      "Ya existe el nombre de política del ensayo.");
    assert.equal(decision(failedKey), "allowed", "El consumidor debe tener permiso antes del ensayo.");
    policyAttempted = true;
    call(["iam", "put-role-policy", ...rolePolicy, "--policy-document", "file://" + policyPath]);
    await waitFor(() => decision(failedKey) === "explicitDeny", 45, "IAM aún no muestra la restricción para la revisión de prueba.");
    assert.equal(decision(`EVENT#${normal}#1`), "allowed", "Confirma que la cita de control conserva permiso.");

    console.log("Comprobando el historial de la cita de control.");
    const control = [
      ["CitaReservada", "BOOKED"], ["CitaReprogramada", "BOOKED"], ["CitaCancelada", "CANCELLED"]
    ];
    evidence.control = [];
    for (const [i, [type, status]] of control.entries()) {
      const revision = i + 1;
      const expected = sendChange(normal, revision, type, status);
      const row = await waitFor(() => readAudit(normal, revision), 55, "Falta una revisión de la cita de control.");
      assert.deepEqual(row, expected);
      evidence.control.push(row);
    }

    console.log("Esperando el objeto de fallo publicado por el mapeo.");
    const expected = sendChange(failing, 1, "CitaReservada", "BOOKED");
    const archive = await findArchive();
    evidence.archivo = archive;
    assert.equal(readAudit(failing, 1), undefined, "La revisión con fallo ya estaba en la tabla de auditoría.");
    const failures = await waitFor(() => {
      const messages = call(["logs", "filter-log-events", "--log-group-name", "/aws/lambda/" + audit,
        "--start-time", String(started), "--filter-pattern", '"' + archive.eventId + '"', "--query", "events[].message"]);
      const matched = (messages ?? []).filter(message => message.includes("audit-event-failed") && message.includes(archive.eventId));
      return matched.length >= 2 && matched.length;
    }, 75, "CloudWatch aún no muestra el fallo inicial y un reintento para el evento.");
    evidence.intentosFallidosObservados = failures;

    console.log("Retirando la restricción y reprocesando el objeto dos veces.");
    removePolicy();
    await waitFor(() => decision(failedKey) === "allowed", 45, "IAM aún no muestra el permiso restaurado.");
    evidence.reprocesos = [];
    for (let i = 0; i < 2; i++) {
      const result = await waitFor(async () => {
        try {
          return await replayFailedBatch({ key: archive.key, stage, account }, { run: call });
        } catch (error) {
          // La ejecución de Lambda puede tardar un poco más que el simulador en ver el permiso restaurado.
          if (error.message !== "Persisten registros fallidos.") throw error;
        }
      }, 240, "El consumidor siguió reportando fallos después de restablecer el permiso.", 10_000);
      assert.equal(result.records, archive.payloadRecords);
      assert.deepEqual(readAudit(failing, 1), expected);
      evidence.reprocesos.push(result);
    }
    for (const row of evidence.control) assert.deepEqual(readAudit(normal, row.revision), row);
    evidence.recuperada = readAudit(failing, 1);
    evidence.estado = "verificado";
  } catch (error) {
    evidence.error = error.message.replaceAll(account, "[cuenta]");
    throw error;
  } finally {
    const problems = [];
    if (policyAttempted) {
      try { removePolicy(); }
      catch { problems.push("Revisar retiro de la política temporal " + policyName + "."); }
    }
    for (const pk of originKeys) {
      try {
        call(["dynamodb", "delete-item", "--table-name", agendaTable, "--key", JSON.stringify(marshall({ pk })),
          "--condition-expression", "attribute_not_exists(pk) OR demoRun = :run",
          "--expression-attribute-values", JSON.stringify(marshall({ ":run": run }))]);
      } catch { problems.push("Verificar retiro de la cita sintética " + pk + "."); }
    }
    evidence.limpiezaPendiente = problems;
    evidence.finUtc = new Date().toISOString();
    const manifest = join(dir, "resultado.json");
    await writeFile(manifest, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log("Evidencia privada en " + manifest);
    if (problems.length) throw new Error(problems.join(" "));
  }
}
