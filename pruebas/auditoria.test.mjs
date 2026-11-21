import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createAuditConsumer } from "../src/backend/auditoria.mjs";
import { replayFailedBatch } from "../scripts/reprocesar-evento.mjs";
import { memoryStore } from "./fixtures.mjs";

function change(id, revision, eventType, sequence, extra = {}) {
  return {
    eventSource: "aws:dynamodb", eventName: revision === 1 ? "INSERT" : "MODIFY", eventID: "evento-" + sequence,
    dynamodb: {
      SequenceNumber: sequence,
      NewImage: marshall({
        entity: "APPOINTMENT", id, revision, eventType, changedAt: "2026-11-20T15:00:00Z",
        clinic: "sede-norte", service: "odontologia", requestId: "solicitud-" + sequence,
        patient: "PACIENTE-PRIVADO", clinicalNote: "NOTA-PRIVADA", token: "SECRETO-DE-PRUEBA", ...extra
      })
    }
  };
}

test("P-09 CA-01/02/05 · tres revisiones fuera de orden y repetidas conservan el historial mínimo", async t => {
  const messages = [];
  t.mock.method(console, "log", message => messages.push(message));
  t.mock.method(console, "warn", message => messages.push(message));
  const store = memoryStore();
  const writes = t.mock.method(store, "create");
  const consume = createAuditConsumer(store);
  const types = ["CitaReservada", "CitaReprogramada", "CitaCancelada"];
  const changes = types.map((type, i) => change("demo-a", i + 1, type, String(i + 1)));
  const unrelated = change("ignorada", 1, types[0], "7", { entity: "SLOT" });
  const otherType = change("desconocida", 1, "PerfilCreado", "8");
  const duplicate = change("demo-a", 1, types[0], "9");
  for (const records of [[changes[2], unrelated, changes[0]], [duplicate, changes[1], otherType], changes]) {
    assert.deepEqual(await consume({ Records: records }), { batchItemFailures: [] });
  }
  for (const [i, type] of types.entries()) {
    const revision = i + 1;
    const pk = `EVENT#demo-a#${revision}`;
    assert.deepEqual(await store.get(pk), {
      pk, entity: "AUDIT", eventId: `demo-a#${revision}`, appointmentId: "demo-a", revision, type,
      changedAt: "2026-11-20T15:00:00Z", clinic: "sede-norte", service: "odontologia",
      requestId: "solicitud-" + revision
    });
  }
  assert.equal(await store.get("EVENT#ignorada#1"), undefined);
  assert.equal(await store.get("EVENT#desconocida#1"), undefined);
  const insertions = await Promise.all(writes.mock.calls.map(call => call.result));
  assert.equal(insertions.filter(Boolean).length, 3);
  assert.ok(messages.length > 0);
  assert.doesNotMatch(messages.join("\n"), /PACIENTE-PRIVADO|NOTA-PRIVADA|SECRETO-DE-PRUEBA/);
});

test("P-09 CA-03 · el fallo parcial identifica su secuencia y el reintento conserva el avance", async t => {
  const messages = [];
  t.mock.method(console, "warn", message => messages.push(message));
  const store = memoryStore();
  let outage = true;
  const consume = createAuditConsumer({ async create(item) {
    if (outage && item.appointmentId === "pendiente") throw new Error("SECRETO-DE-PRUEBA");
    return store.create(item);
  } });
  const batch = { Records: [change("pendiente", 1, "CitaReservada", "21"), change("guardada", 1, "CitaReservada", "22")] };
  assert.deepEqual(await consume(batch), { batchItemFailures: [{ itemIdentifier: "21" }] });
  const saved = await store.get("EVENT#guardada#1");
  assert.equal(saved.requestId, "solicitud-22");
  assert.equal(await store.get("EVENT#pendiente#1"), undefined);
  assert.ok(messages.length > 0);
  assert.doesNotMatch(messages.join("\n"), /PACIENTE-PRIVADO|NOTA-PRIVADA|SECRETO-DE-PRUEBA/);
  outage = false;
  assert.deepEqual(await consume(batch), { batchItemFailures: [] });
  assert.deepEqual(await store.get("EVENT#guardada#1"), saved);
  assert.equal((await store.get("EVENT#pendiente#1")).requestId, "solicitud-21");
});

const account = "123456789012";
const key = "aws/lambda/abc-mapping/shard-001/2026/11/20/2026-11-20T15.00.00-demo";
const options = { stage: "dev", account, key };
const batch = { Records: [change("recuperar", 1, "CitaReservada", "41")] };

// El doble sustituye solo la red. El comando lee y escribe archivos reales y entrega el lote al consumidor.
function awsDouble(envelope, invoke, expectedKey = key) {
  const operations = [];
  return {
    operations,
    checkAccount(actual) {
      assert.equal(actual, account);
      operations.push("sts");
    },
    async run(args) {
      const [service, operation] = args;
      operations.push(service);
      if (service === "s3api") {
        assert.deepEqual(args.slice(0, -1), ["s3api", "get-object", "--bucket", "medipoli-dev-fallos-" + account,
          "--expected-bucket-owner", account, "--key", expectedKey]);
        await writeFile(args.at(-1), JSON.stringify(envelope));
        return {};
      }
      assert.equal(operation, "invoke");
      assert.deepEqual(args.slice(0, 5), ["lambda", "invoke", "--function-name", "medipoli-dev-auditoria", "--payload"]);
      assert.ok(args[5].startsWith("fileb://"));
      const original = JSON.parse(await readFile(args[5].slice("fileb://".length), "utf8"));
      const response = await invoke(original);
      await writeFile(args.at(-1), response.body);
      return response.metadata;
    }
  };
}

test("P-09 CA-04 · el objeto oficial sin extensión se reprocesa dos veces con el mismo resultado", async t => {
  const store = memoryStore();
  const writes = t.mock.method(store, "create");
  const consume = createAuditConsumer(store);
  const deps = awsDouble({ requestContext: { condition: "RetryAttemptsExhausted" }, payload: JSON.stringify(batch) }, async event => {
    assert.deepEqual(event, batch);
    return { metadata: { StatusCode: 200 }, body: JSON.stringify(await consume(event)) };
  });
  for (let i = 0; i < 2; i++) {
    const output = await replayFailedBatch(options, deps);
    assert.equal(output.ok, true);
    assert.equal(output.records, 1);
    assert.equal(output.environment, "dev");
    assert.ok(Number.isFinite(Date.parse(output.utc)));
  }
  assert.deepEqual(deps.operations, ["sts", "s3api", "lambda", "sts", "s3api", "lambda"]);
  assert.deepEqual(await Promise.all(writes.mock.calls.map(call => call.result)), [true, false]);
  assert.equal((await store.get("EVENT#recuperar#1")).requestId, "solicitud-41");
});

test("P-09 CA-04 · los archivos anteriores con requestPayload y extensión siguen siendo legibles", async () => {
  const legacy = { ...options, key: key + ".json" };
  for (const previous of [batch, JSON.stringify(batch)]) {
    const deps = awsDouble({ requestPayload: previous }, async event => {
      assert.deepEqual(event, batch);
      return { metadata: { StatusCode: 200 }, body: '{"batchItemFailures":[]}' };
    }, legacy.key);
    assert.equal((await replayFailedBatch(legacy, deps)).ok, true);
  }
});

test("P-09 CA-04 · un resultado parcial, ilegible o ambiguo mantiene el lote pendiente", async () => {
  const legacy = { ...options, key: key + ".json" };
  for (const [metadata, body] of [
    [{ StatusCode: 200 }, '{"batchItemFailures":[{"itemIdentifier":"41"}]}'],
    [{ StatusCode: 200, FunctionError: "Unhandled" }, '{"batchItemFailures":[]}'],
    [{ StatusCode: 202 }, '{"batchItemFailures":[]}'],
    [{ StatusCode: 200 }, '{}'],
    [{ StatusCode: 200 }, '{"batchItemFailures":{}}'],
    [{ StatusCode: 200 }, 'respuesta incompleta']
  ]) {
    const deps = awsDouble({ requestPayload: batch }, async () => ({ metadata, body }), legacy.key);
    await assert.rejects(replayFailedBatch(legacy, deps));
    assert.deepEqual(deps.operations, ["sts", "s3api", "lambda"]);
  }
});

test("P-09 CA-04/05 · valida el ambiente, la cuenta, la clave y el contenido antes de invocar", async () => {
  for (const invalid of [{ ...options, stage: "otro" }, { ...options, key: "otro/objeto" }, { ...options, key: key + "\n" }]) {
    const deps = awsDouble({}, () => assert.fail("Invocación inesperada"));
    await assert.rejects(replayFailedBatch(invalid, deps));
    assert.deepEqual(deps.operations, []);
  }
  const wrongAccount = awsDouble({}, () => assert.fail("Invocación inesperada"));
  await assert.rejects(replayFailedBatch(options, { ...wrongAccount, checkAccount() { throw new Error("cuenta distinta"); } }), /cuenta distinta/);
  assert.deepEqual(wrongAccount.operations, []);
  for (const bad of ["no es JSON", { Records: [] }, { Records: [{ eventSource: "aws:sqs" }] },
    { Records: [{ eventSource: "aws:dynamodb", dynamodb: {} }] }, { Records: [null] }]) {
    const deps = awsDouble({ payload: bad }, () => assert.fail("Invocación inesperada"));
    await assert.rejects(replayFailedBatch(options, deps));
    assert.deepEqual(deps.operations, ["sts", "s3api"]);
  }
});
