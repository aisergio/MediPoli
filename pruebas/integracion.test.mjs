import { test } from "node:test";
import assert from "node:assert/strict";
import { marshall } from "@aws-sdk/util-dynamodb";
import { createApi } from "../src/backend/api.mjs";
import { createAgenda } from "../src/backend/agenda.mjs";
import { createAuditConsumer } from "../src/backend/auditoria.mjs";
import { memoryStore, patientA, slot, testHour, testSlots } from "./fixtures.mjs";

const publicOrigin = "https://aisergio.dev";
const resource = publicOrigin + "/MediPoli/mcp";
const webScope = publicOrigin + "/MediPoli/api/agenda";

function setup({ mcpPublicOrigin = publicOrigin, assistant } = {}) {
  const store = memoryStore([...testSlots, { pk: "PROFILE#" + patientA.id, role: "paciente", name: "Paciente A" }]);
  const agenda = createAgenda(store, { clock: () => testHour });
  const api = createApi({
    agenda, store, assistant,
    directory: { ensure() { throw new Error("El paciente no debería llegar aquí."); } },
    mcpVerifier: { async verify(token) {
      if (token === "expired") throw new Error("expired");
      if (token === "alias-token") return { sub: patientA.id, aud: mcpPublicOrigin + "/MediPoli/mcp",
        scope: mcpPublicOrigin + "/MediPoli/mcp/read" };
      return { sub: patientA.id, aud: token === "wrong-audience" ? "https://wrong.invalid" : resource,
        scope: resource + "/read" + (token === "read-only" ? "" : " " + resource + "/reserve") };
    } },
    publicOrigin, mcpPublicOrigin, webScope, issuer: "https://cognito-idp.us-east-2.amazonaws.com/demo",
    allowedOrigins: [publicOrigin]
  });
  const send = (path, method = "GET", { claims, headers, body } = {}) => api({
    rawPath: path, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method }, requestId: "evidence-demo", authorizer: { jwt: { claims } } }
  }, { functionVersion: "local-test" });
  return { send, store, agenda };
}

test("P-02: API exige token de acceso y scope; P-08: el paciente no puede crear cuentas", async () => {
  const { send } = setup();
  const claims = { sub: patientA.id, token_use: "access", scope: webScope };
  assert.equal((await send("/MediPoli/api/perfil")).statusCode, 401);
  assert.equal((await send("/MediPoli/api/perfil", "GET", { claims: { ...claims, token_use: "id" } })).statusCode, 401);
  assert.equal((await send("/MediPoli/api/perfil", "GET", { claims })).statusCode, 200);
  assert.equal((await send("/MediPoli/api/admin/altas", "POST", { claims, body: {} })).statusCode, 403);
});

test("IA-01: el asistente requiere un perfil autenticado y aparece cuando está habilitado", async () => {
  const queries = [];
  const { send } = setup({ async assistant(query) {
    queries.push(query);
    return { respuesta: "Medicina general y odontología", fuente: "bedrock" };
  } });
  const claims = { sub: patientA.id, token_use: "access", scope: webScope };
  const path = "/MediPoli/api/asistente";
  const body = { consulta: "servicios" };
  assert.equal((await send(path, "POST", { body })).statusCode, 401);
  assert.equal((await send(path, "POST", { claims: { ...claims, sub: "sin-perfil" }, body })).statusCode, 403);
  assert.deepEqual(queries, []);
  const profile = JSON.parse((await send("/MediPoli/api/perfil", "GET", { claims })).body);
  assert.equal(profile.asistente, true);
  const response = await send(path, "POST", { claims, body: { ...body, texto: "campo no utilizado" } });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).fuente, "bedrock");
  assert.deepEqual(queries, ["servicios"]);
  assert.equal((await setup().send(path, "POST", { claims, body })).statusCode, 404);
});

test("P-14: el MCP anuncia OAuth y verifica origen, audiencia y token", async () => {
  const { send } = setup();
  const meta = await send("/.well-known/oauth-protected-resource/MediPoli/mcp");
  assert.equal(JSON.parse(meta.body).resource, resource);
  const missing = await send("/MediPoli/mcp", "POST");
  assert.equal(missing.statusCode, 401);
  assert.match(missing.headers["www-authenticate"], /oauth-protected-resource/);
  for (const token of ["wrong-audience", "expired"]) {
    assert.equal((await send("/MediPoli/mcp", "POST", { headers: { authorization: "Bearer " + token } })).statusCode, 401);
  }
  assert.equal((await send("/MediPoli/mcp", "POST", { headers: { origin: "https://unsolicited.invalid" } })).statusCode, 403);
});

test("P-14: la herramienta MCP exige confirmación y comparte la cita con la web", async () => {
  const { send, agenda } = setup();
  const headers = { authorization: "Bearer valid-test-token", "content-type": "application/json", accept: "application/json, text/event-stream" };
  const rpc = (method, params, extraHeaders = {}) => send("/MediPoli/mcp", "POST", {
    headers: { ...headers, ...extraHeaders }, body: { jsonrpc: "2.0", id: 1, method, params }
  });
  const tools = await rpc("tools/list", {});
  assert.equal(tools.statusCode, 200);
  assert.equal(JSON.parse(tools.body).result.tools.length, 3);
  const args = { slotId: slot(), confirmada: false, clave: "request_mcp1" };
  const attempt = await rpc("tools/call", { name: "reservar_cita", arguments: args });
  assert.equal(JSON.parse(attempt.body).result.isError, true);
  assert.deepEqual(await agenda.ownAppointments(patientA), []);
  args.confirmada = true;
  const denied = await rpc("tools/call", { name: "reservar_cita", arguments: args }, { authorization: "Bearer read-only" });
  assert.equal(JSON.parse(denied.body).result.isError, true);
  const ok = await rpc("tools/call", { name: "reservar_cita", arguments: args });
  const reservation = JSON.parse(JSON.parse(ok.body).result.content[0].text);
  const claims = { sub: patientA.id, token_use: "access", scope: webScope };
  const page = await send("/MediPoli/api/citas", "GET", { claims });
  assert.equal(JSON.parse(page.body)[0].id, reservation.id);
});

test("El dominio MCP anuncia su audiencia y acepta sus permisos propios", async () => {
  const alias = "https://demo.aisergio.dev";
  const { send } = setup({ mcpPublicOrigin: alias });
  const headers = { "x-medipoli-mcp-origin": alias, origin: alias, "content-type": "application/json",
    accept: "application/json, text/event-stream" };
  const metadata = await send("/.well-known/oauth-protected-resource/MediPoli/mcp", "GET", { headers });
  assert.equal(JSON.parse(metadata.body).resource, alias + "/MediPoli/mcp");
  assert.deepEqual(JSON.parse(metadata.body).scopes_supported, [alias + "/MediPoli/mcp/read", alias + "/MediPoli/mcp/reserve"]);
  const body = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "consultar_mis_citas", arguments: {} } };
  const nativeToken = await send("/MediPoli/mcp", "POST", { body, headers: { ...headers, authorization: "Bearer valid-test-token" } });
  assert.equal(nativeToken.statusCode, 401);
  assert.match(nativeToken.headers["www-authenticate"], /demo\.aisergio\.dev/);
  const accepted = await send("/MediPoli/mcp", "POST", { body, headers: { ...headers, authorization: "Bearer alias-token" } });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.parse(accepted.body).result.content[0].text), []);
});

test("P-09: duplicado de Streams y reproceso quedan en un solo registro", async () => {
  const { agenda, store } = setup();
  const appointment = await agenda.book(patientA, slot(), "request_audit", "correlacion-u3");
  const item = await store.get("APT#" + appointment.id);
  const payload = { Records: [{
    eventID: "evento-1",
    dynamodb: { NewImage: marshall(item), SequenceNumber: "33" }
  }] };
  const output = memoryStore();
  let transient = true;
  const run = createAuditConsumer({ async create(row) {
    if (transient) { transient = false; throw new Error("fallo de prueba"); }
    return output.create(row);
  } });
  assert.deepEqual(await run(payload), { batchItemFailures: [{ itemIdentifier: "33" }] });
  assert.deepEqual(await run(payload), { batchItemFailures: [] });
  assert.deepEqual(await run(payload), { batchItemFailures: [] });
  const saved = await output.get(`EVENT#${appointment.id}#1`);
  assert.equal(saved.requestId, "correlacion-u3");
  assert.equal(saved.patient, undefined);
});
