import { mkdir, readdir, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { aws, assertAccount } from "./aws-cli.mjs";
import { evaluateCanary } from "./canary.mjs";

const env = process.env;
const stage = env.MEDIPOLI_ENV;
const mode = env.RELEASE_MODE ?? "canary";
if (!["dev", "prod"].includes(stage) || !["directo-dev", "canary"].includes(mode) ||
  (stage === "prod" && mode !== "canary")) throw new Error("Ambiente o modo de despliegue inválido.");
assertAccount(env.AWS_EXPECTED_ACCOUNT);
const name = `medipoli-${stage}`;
const functionName = name + "-api";
const bucket = env.MEDIPOLI_SITE_BUCKET;
if (bucket !== `${name}-web-${env.AWS_EXPECTED_ACCOUNT}` || !/^[A-Z0-9]+$/.test(env.MEDIPOLI_CF_ID ?? "")) {
  throw new Error("El bucket o la distribución no corresponde a MediPoli.");
}
const api = new URL(env.MEDIPOLI_API_ORIGIN);
if (api.protocol !== "https:" || !/^[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/.test(api.hostname) || api.pathname !== "/") {
  throw new Error("Se requiere el origen HTTPS de la API de MediPoli.");
}
if (mode === "canary" && !env.SMOKE_ACCESS_TOKEN) throw new Error("Se requiere un token temporal de un paciente ficticio para medir disponibilidad.");
const fault = env.MEDIPOLI_TEST_ROLLBACK === "true";
if (fault && (stage !== "dev" || mode !== "canary")) throw new Error("El ensayo de reversión solo se ejecuta con Canary en dev.");
await mkdir(".work/release", { recursive: true });

function setAlias(which, version, weights, revisionId) {
  return aws(["lambda", "update-alias", "--function-name", functionName, "--name", which,
    "--function-version", version, "--routing-config", JSON.stringify({ AdditionalVersionWeights: weights }),
    ...(revisionId ? ["--revision-id", revisionId] : [])]);
}

async function probe(path, authorized = false) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(path, api), {
      headers: authorized ? { authorization: "Bearer " + env.SMOKE_ACCESS_TOKEN } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    const version = response.headers.get("x-medipoli-version");
    const data = await response.json().catch(() => null);
    return { status: response.status, version, ms: Math.round(performance.now() - start), data };
  } catch {
    return { status: 599, version: null, ms: Math.round(performance.now() - start), data: null };
  }
}

function putHtml(file) {
  const key = "MediPoli/" + file.replaceAll("\\", "/");
  aws(["s3api", "put-object", "--bucket", bucket, "--key", key, "--body", "dist/" + file,
    "--content-type", "text/html; charset=utf-8", "--cache-control", "no-cache"]);
}

const originalAlias = aws(["lambda", "get-alias", "--function-name", functionName, "--name", "live"]);
const stable = originalAlias.FunctionVersion;
if (Object.keys(originalAlias.RoutingConfig?.AdditionalVersionWeights ?? {}).length) throw new Error("Ya hay un Canary activo.");
const before = await probe("/MediPoli/api/health");
if (before.status !== 200 || before.version !== stable) throw new Error("La versión estable no superó la comprobación inicial.");
const auditFunction = name + "-auditoria";
const deployed = aws(["lambda", "update-function-code", "--function-name", functionName, "--zip-file", "fileb://.work/build/api.zip", "--publish"]);
const candidate = deployed.Version;
if (!/^\d+$/.test(candidate ?? "")) throw new Error("Lambda no devolvió una versión publicada.");
aws(["lambda", "wait", "function-updated-v2", "--function-name", functionName], { json: false });
setAlias("candidate", candidate, {});
const tested = await probe("/MediPoli/api/candidate-health");
if (tested.status !== 200 || tested.data?.ok !== true || tested.version !== candidate) throw new Error("Falló la comprobación de la versión candidata.");

let touched;
let summary;
const files = (await readdir("dist", { recursive: true })).filter(file => file.endsWith(".html"));
if (!files.includes("index.html")) throw new Error("Falta la salida HTML de Astro.");
const written = new Map();
try {
  if (mode === "canary" && candidate !== stable) {
    touched = setAlias("live", stable, { [candidate]: .1 }, originalAlias.RevisionId);
    const queries = new URLSearchParams({ date: env.CANARY_DATE ?? new Date().toISOString().slice(0, 10), service: "medicina-general" });
    const route = "/MediPoli/api/disponibilidad?" + queries;
    const samples = [];
    const started = Date.now();
    await Promise.all(Array.from({ length: 5 }, async (_, worker) => {
      await sleep(worker * 130);
      while (Date.now() - started < 300_000) {
        const received = await probe(route, true);
        samples.push({ status: received.status, version: received.version, ms: received.ms });
        await sleep(850);
      }
    }));
    summary = evaluateCanary(samples, candidate, Date.now() - started);
    if (fault) summary = { ...summary, outcome: "revertir", rehearsal: true };
    if (summary.outcome !== "promover") throw new Error("El Canary no cumplió los criterios de promoción.");
  }
  aws(["s3", "sync", "dist/", `s3://${bucket}/MediPoli/`, "--exclude", "*.html", "--cache-control", "public,max-age=86400", "--only-show-errors"], { json: false });
  // Mantener los activos con hash permite que la página anterior siga funcionando.
  for (const file of files) {
    const key = "MediPoli/" + file.replaceAll("\\", "/");
    let priorVersion = null;
    try { priorVersion = aws(["s3api", "head-object", "--bucket", bucket, "--key", key]).VersionId ?? null; }
    catch (error) { if (!/404|Not Found/.test(error.message)) throw error; }
    putHtml(file);
    written.set(key, priorVersion);
  }
  if (candidate !== stable) touched = setAlias("live", candidate, {}, touched?.RevisionId ?? originalAlias.RevisionId);
  const after = await probe("/MediPoli/api/health");
  if (after.status !== 200 || after.version !== candidate) throw new Error("La versión promovida no respondió como se esperaba.");
  aws(["lambda", "update-function-code", "--function-name", auditFunction, "--zip-file", "fileb://.work/build/auditoria.zip"]);
  aws(["lambda", "wait", "function-updated-v2", "--function-name", auditFunction], { json: false });
  aws(["cloudfront", "create-invalidation", "--distribution-id", env.MEDIPOLI_CF_ID, "--paths", "/MediPoli/*"]);
  summary = { ...summary, outcome: "publicado", stable, candidate, mode, html: files.length };
} catch (error) {
  if (touched) {
    setAlias("live", stable, {}, touched.RevisionId);
    const restored = await probe("/MediPoli/api/health");
    if (restored.status !== 200 || restored.version !== stable) throw new Error("No se comprobó el rollback de Lambda.");
  }
  for (const [key, version] of written) {
    if (!version) {
      aws(["s3api", "delete-object", "--bucket", bucket, "--key", key]);
      continue;
    }
    const copySource = [bucket, ...key.split("/")].map(encodeURIComponent).join("/") + "?versionId=" + encodeURIComponent(version);
    aws(["s3api", "copy-object", "--bucket", bucket, "--key", key, "--copy-source", copySource]);
  }
  if (written.size) aws(["cloudfront", "create-invalidation", "--distribution-id", env.MEDIPOLI_CF_ID, "--paths", "/MediPoli/*"]);
  summary = { ...summary, outcome: summary?.outcome ?? "revertir", rolledBack: Boolean(touched), stable, candidate };
  throw error;
} finally {
  const result = JSON.stringify({ ...summary, utc: new Date().toISOString(), commit: env.GITHUB_SHA ?? "local" }, null, 2);
  await writeFile(".work/release/resultado.json", result);
  console.log(result);
}
