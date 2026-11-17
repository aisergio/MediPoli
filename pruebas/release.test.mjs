import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCanary } from "../scripts/canary.mjs";
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
