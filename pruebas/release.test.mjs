import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createRehearsalArchive, evaluateCanary, readCanaryPatient } from "../scripts/canary.mjs";
import proxy from "../cloudflare/worker.mjs";

const sample = (version, ms = 120, status = 200) => ({ version, ms, status });
test("P-12: no se promueve un Canary con tiempo o muestras insuficientes", () => {
  const small = Array.from({ length: 99 }, () => sample("2"));
  assert.equal(evaluateCanary(small, "2", 310000).outcome, "inconcluso");
  assert.equal(evaluateCanary([...small, sample("2")], "2", 299000).outcome, "inconcluso");
});

test("P-12: distingue promoción y reversión por latencia, errores y falta de versión", () => {
  const ok = Array.from({ length: 100 }, () => sample("2"));
  assert.equal(evaluateCanary(ok, "2", 310000).outcome, "promover");
  assert.equal(evaluateCanary(ok.map((item, i) => i >= 94 ? sample("2", 2100) : item), "2", 310000).outcome, "revertir");
  assert.equal(evaluateCanary(ok.map((item, i) => i < 2 ? sample("2", 15, 500) : item), "2", 310000).outcome, "revertir");
  assert.equal(evaluateCanary([...ok, sample(null, 200, 502)], "2", 310000).outcome, "revertir");
  assert.equal(evaluateCanary(ok, "2", 310000, "1").outcome, "inconcluso");
  const mixed = [...ok, sample("1")];
  assert.equal(evaluateCanary(mixed, "2", 310000, "1").stableSamples, 1);
  assert.equal(evaluateCanary([...mixed, sample(null, 90, 401)], "2", 310000, "1").outcome, "revertir");
});

test("U4-C01: el canario de dev exige la sesión vigente de una identidad sintética", () => {
  const subject = "a3c95acf-1904-4c8a-bde3-7e8011a9f441";
  const now = 1_795_786_000_000;
  const claims = { sub: subject, token_use: "access", username: "prueba-canary-abcdef", exp: now / 1000 + 900 };
  const token = changes => "header." + Buffer.from(JSON.stringify({ ...claims, ...changes })).toString("base64url") + ".signature";
  assert.equal(readCanaryPatient(token(), now), subject);
  assert.throws(() => readCanaryPatient(token({ username: "paciente" }), now));
  assert.throws(() => readCanaryPatient(token({ exp: now / 1000 + 90 }), now));
});

test("U4-C03: el paquete de ensayo responde 503 solo para el paciente y la ruta del canario", async () => {
  const subject = "a3c95acf-1904-4c8a-bde3-7e8011a9f441";
  const source = zipSync({ "index.cjs": strToU8("exports.handler = async () => ({ statusCode: 200 });") });
  const archive = unzipSync(createRehearsalArchive(source, subject));
  assert.equal(strFromU8(archive["api-sana.cjs"]), strFromU8(unzipSync(source)["index.cjs"]));
  const exports = {};
  runInNewContext(strFromU8(archive["index.cjs"]), {
    exports, require: () => ({ handler: async () => ({ statusCode: 200 }) }), console: { log() {} }
  });
  const event = (sub, rawPath) => ({
    rawPath, requestContext: { http: { method: "GET" }, authorizer: { jwt: { claims: { sub, token_use: "access" } } } }
  });
  const availability = "/MediPoli/api/disponibilidad";
  const context = { functionVersion: "2", awsRequestId: "request" };
  const failed = await exports.handler(event(subject, availability), context);
  assert.equal(failed.statusCode, 503);
  assert.equal(failed.headers["x-medipoli-version"], "2");
  assert.equal(failed.headers["x-medipoli-canary-fault"], "controlled");
  assert.equal((await exports.handler(event("otro-paciente", availability), context)).statusCode, 200);
  assert.equal((await exports.handler(event(subject, "/MediPoli/api/health"), context)).statusCode, 200);
  const failedSamples = Array.from({ length: 100 }, () => ({ ...sample("2", 20, 503), controlledFailure: true }));
  const result = evaluateCanary([...failedSamples, sample("1")], "2", 310000, "1");
  assert.equal(result.controlledFailures, 100);
  assert.equal(result.outcome, "revertir");
});

test("Cloudflare separa las rutas de MediPoli, el video y el resto del dominio", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async request => new Response(request.url));
  const env = { CLOUDFRONT_HOST: "demo.cloudfront.net" };
  const request = path => proxy.fetch(new Request(path), env);
  assert.equal(await (await request("https://aisergio.dev/otro")).text(), "https://aisergio.dev/otro");
  assert.equal(await (await request("https://aisergio.dev/MediPoliOtro")).text(), "https://aisergio.dev/MediPoliOtro");
  assert.equal(await (await request("https://aisergio.dev/MediPoli/api/health")).text(), "https://demo.cloudfront.net/MediPoli/api/health");
  assert.equal(await (await request("https://video.aisergio.dev/MediPoli/u2.mp4")).text(), "https://demo.cloudfront.net/MediPoli/videos/u2.mp4");
  assert.equal((await request("https://aisergio.dev/MediPoli")).status, 308);
  assert.equal(fetch.mock.calls.length, 4);
});
