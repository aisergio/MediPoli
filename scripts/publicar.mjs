import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { aws, assertAccount } from "./aws-cli.mjs";
import { canaryPatientName, createRehearsalArchive, evaluateCanary, readCanaryPatient } from "./canary.mjs";
import { dateBogota } from "../src/shared/catalogo.mjs";

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
const syntheticSubject = stage === "dev" && mode === "canary" ? readCanaryPatient(env.SMOKE_ACCESS_TOKEN) : null;
await mkdir(".work/release", { recursive: true });

function setAlias(which, version, weights, revisionId) {
  return aws(["lambda", "update-alias", "--function-name", functionName, "--name", which,
    "--function-version", version, "--routing-config", JSON.stringify({ AdditionalVersionWeights: weights }),
    ...(revisionId ? ["--revision-id", revisionId] : [])]);
}

async function probe(path, authorized = false, timeoutMs = 5000) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(path, api), {
      headers: authorized ? { authorization: "Bearer " + env.SMOKE_ACCESS_TOKEN } : {},
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
    const version = response.headers.get("x-medipoli-version");
    const data = await response.json().catch(() => null);
    return {
      status: response.status, version, ms: Math.round(performance.now() - start), data,
      controlledFailure: response.headers.get("x-medipoli-canary-fault") === "controlled"
    };
  } catch {
    return { status: 599, version: null, ms: Math.round(performance.now() - start), data: null };
  }
}

const healthChecks = {};

async function confirmVersion(label, path, expected) {
  const start = performance.now();
  const deadline = start + 20_000;
  let attempts = 0;
  let last;
  let healthy;
  do {
    attempts++;
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    last = await probe(path, false, Math.min(5000, remaining));
    healthy = last.status === 200 && last.version === expected && last.data?.ok === true;
    if (healthy) break;
    const pause = Math.min(650, deadline - performance.now());
    if (pause > 0) await sleep(pause);
  } while (performance.now() < deadline);

  healthChecks[label] = {
    expected, observed: last.version, status: last.status, attempts,
    elapsedMs: Math.round(performance.now() - start)
  };
  if (!healthy) {
    throw new Error(`La comprobación ${label} terminó con HTTP ${last.status} y versión ${last.version ?? "desconocida"}. Se esperaba la versión ${expected}.`);
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
await confirmVersion("estable", "/MediPoli/api/health", stable);
const queries = new URLSearchParams({ date: env.CANARY_DATE ?? dateBogota(), service: "medicina-general" });
const sampleRoute = "/MediPoli/api/disponibilidad?" + queries;
if (mode === "canary") {
  const profile = await probe("/MediPoli/api/perfil", true);
  const available = await probe(sampleRoute, true);
  if (profile.status !== 200 || profile.version !== stable || profile.data?.role !== "paciente" ||
    (syntheticSubject && profile.data?.name !== canaryPatientName) ||
    available.status !== 200 || available.version !== stable || !Array.isArray(available.data)) {
    throw new Error("La versión estable no superó la comprobación autenticada de disponibilidad.");
  }
  healthChecks.disponibilidadEstable = { status: available.status, version: available.version, elapsedMs: available.ms };
}
const auditFunction = name + "-auditoria";
const healthyArchive = ".work/build/api.zip";
const priorCandidate = aws(["lambda", "get-alias", "--function-name", functionName, "--name", "candidate"]);
const candidateWeight = .1;
let candidate;
let candidateAlias;
let touched;
let summary;
let restoreHealthyCode = false;
const files = (await readdir("dist", { recursive: true })).filter(file => file.endsWith(".html"));
if (!files.includes("index.html")) throw new Error("Falta la salida HTML de Astro.");
const written = new Map();
try {
  let archive = healthyArchive;
  if (fault) {
    archive = ".work/build/api-ensayo.zip";
    await writeFile(archive, createRehearsalArchive(await readFile(healthyArchive), syntheticSubject));
    restoreHealthyCode = true;
  }
  const deployed = aws(["lambda", "update-function-code", "--function-name", functionName, "--zip-file", "fileb://" + archive, "--publish"]);
  candidate = deployed.Version;
  if (!/^\d+$/.test(candidate ?? "") || (mode === "canary" && candidate === stable)) {
    throw new Error("Lambda debe publicar una versión distinta para el Canary.");
  }
  aws(["lambda", "wait", "function-updated-v2", "--function-name", functionName], { json: false });
  candidateAlias = setAlias("candidate", candidate, {}, priorCandidate.RevisionId);
  await confirmVersion("candidata", "/MediPoli/api/candidate-health", candidate);

  if (mode === "canary") {
    touched = setAlias("live", stable, { [candidate]: candidateWeight }, originalAlias.RevisionId);
    if (touched.FunctionVersion !== stable || touched.RoutingConfig?.AdditionalVersionWeights?.[candidate] !== candidateWeight) {
      throw new Error("Lambda no confirmó el peso de la candidata.");
    }
    const samples = [];
    const started = Date.now();
    await Promise.all(Array.from({ length: 5 }, async (_, worker) => {
      await sleep(worker * 130);
      while (Date.now() - started < 300_000) {
        const { status, version, ms, controlledFailure } = await probe(sampleRoute, true);
        samples.push({ status, version, ms, controlledFailure });
        await sleep(850);
      }
    }));
    summary = {
      ...evaluateCanary(samples, candidate, Date.now() - started, stable), candidateWeight, rehearsal: fault
    };
    if (fault && summary.controlledFailures === 0) throw new Error("El ensayo no observó el fallo controlado.");
    if (summary.outcome !== "promover") throw new Error("El Canary no cumplió los criterios de promoción.");
    if (fault) throw new Error("La versión de ensayo requiere reversión.");
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
  await confirmVersion("promovida", "/MediPoli/api/health", candidate);
  aws(["lambda", "update-function-code", "--function-name", auditFunction, "--zip-file", "fileb://.work/build/auditoria.zip"]);
  aws(["lambda", "wait", "function-updated-v2", "--function-name", auditFunction], { json: false });
  aws(["cloudfront", "create-invalidation", "--distribution-id", env.MEDIPOLI_CF_ID, "--paths", "/MediPoli/*"]);
  summary = { ...summary, outcome: "publicado", stable, candidate, mode, html: files.length };
} catch (error) {
  const restorationErrors = [];
  let rolledBack = false;
  let restoredHtml = 0;
  if (touched) {
    try {
      const restored = setAlias("live", stable, {}, touched.RevisionId);
      if (restored.FunctionVersion !== stable || Object.keys(restored.RoutingConfig?.AdditionalVersionWeights ?? {}).length) {
        throw new Error("El alias estable no confirmó la retirada del peso adicional.");
      }
      await confirmVersion("restaurada", "/MediPoli/api/health", stable);
      rolledBack = true;
    } catch (failure) {
      restorationErrors.push(failure);
    }
  }
  for (const [key, version] of written) {
    try {
      if (version) {
        const copySource = [bucket, ...key.split("/")].map(encodeURIComponent).join("/") + "?versionId=" + encodeURIComponent(version);
        aws(["s3api", "copy-object", "--bucket", bucket, "--key", key, "--copy-source", copySource]);
      } else {
        aws(["s3api", "delete-object", "--bucket", bucket, "--key", key]);
      }
      restoredHtml++;
    } catch (failure) {
      restorationErrors.push(failure);
    }
  }
  if (written.size) {
    try {
      aws(["cloudfront", "create-invalidation", "--distribution-id", env.MEDIPOLI_CF_ID, "--paths", "/MediPoli/*"]);
    } catch (failure) {
      restorationErrors.push(failure);
    }
  }
  if (fault && candidateAlias) {
    try {
      setAlias("candidate", priorCandidate.FunctionVersion, priorCandidate.RoutingConfig?.AdditionalVersionWeights ?? {}, candidateAlias.RevisionId);
      await confirmVersion("candidataRestaurada", "/MediPoli/api/candidate-health", priorCandidate.FunctionVersion);
    } catch (failure) {
      restorationErrors.push(failure);
    }
  }
  if (restoreHealthyCode) {
    try {
      aws(["lambda", "update-function-code", "--function-name", functionName, "--zip-file", "fileb://" + healthyArchive, "--no-publish"]);
      aws(["lambda", "wait", "function-updated-v2", "--function-name", functionName], { json: false });
    } catch (failure) {
      restorationErrors.push(failure);
    }
  }
  summary = {
    ...summary, outcome: restorationErrors.length ? "recuperacion-incompleta" :
      (summary?.outcome === "inconcluso" ? "inconcluso" : "revertir"),
    rolledBack, restoredHtml, stable, candidate, mode
  };
  if (restorationErrors.length) {
    throw new AggregateError([error, ...restorationErrors], "La publicación falló y la restauración quedó incompleta.");
  }
  throw error;
} finally {
  const result = JSON.stringify({ ...summary, healthChecks, utc: new Date().toISOString(), commit: env.CODEBUILD_RESOLVED_SOURCE_VERSION ?? env.GITHUB_SHA ?? "local" }, null, 2);
  await writeFile(".work/release/resultado.json", result);
  console.log(result);
}
