import { strToU8, unzipSync, zipSync } from "fflate";

const subjectPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export const canaryPatientName = "Paciente ficticio para canario";

export function readCanaryPatient(token, now = Date.now()) {
  const parts = token?.split(".");
  let claims;
  try {
    if (parts?.length === 3) claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {}
  if (claims?.token_use !== "access" || !subjectPattern.test(claims?.sub ?? "") ||
    !/^prueba-canary-[a-f0-9]+$/.test(claims.username ?? "") || !Number.isFinite(claims.exp) ||
    claims.exp * 1000 < now + 360_000) {
    throw new Error("La prueba requiere un token vigente del paciente sintético del canario.");
  }
  return claims.sub;
}

export function createRehearsalArchive(healthyZip, subject) {
  if (!subjectPattern.test(subject)) throw new Error("Identidad sintética inválida.");
  const files = unzipSync(healthyZip);
  if (!files["index.cjs"]) throw new Error("El paquete original no contiene el manejador de la API.");
  files["api-sana.cjs"] = files["index.cjs"];
  files["index.cjs"] = strToU8(`const { handler } = require("./api-sana.cjs");
exports.handler = async (event, context) => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  const http = event.requestContext?.http;
  if (http?.method !== "GET" || event.rawPath !== "/MediPoli/api/disponibilidad" ||
      claims?.sub !== ${JSON.stringify(subject)} || claims.token_use !== "access") {
    return handler(event, context);
  }
  const version = context.functionVersion;
  const requestId = event.requestContext?.requestId ?? context.awsRequestId;
  console.log(JSON.stringify({ requestId, version, route: "availability", status: 503, canaryRehearsal: true }));
  return {
    statusCode: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store",
      "x-medipoli-version": version, "x-request-id": requestId, "x-medipoli-canary-fault": "controlled" },
    body: JSON.stringify({ error: "Fallo controlado del ensayo Canary", requestId })
  };
};`);
  return zipSync(files, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
}

export function percentile(ms, fraction) {
  if (ms.length === 0) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function evaluateCanary(samples, candidate, elapsedMs, stable) {
  const versioned = samples.filter(sample => sample.version === candidate);
  const stableSamples = stable ? samples.filter(sample => sample.version === stable) : [];
  const unattributed = samples.filter(sample => !sample.version ||
    (stable && sample.version !== stable && sample.version !== candidate)).length;
  const errors = versioned.filter(sample => sample.status !== 200).length;
  const controlledFailures = versioned.filter(sample => sample.status === 503 && sample.controlledFailure).length;
  const successes = versioned.filter(sample => sample.status === 200).map(sample => sample.ms);
  const p95 = percentile(successes, .95);
  const p99 = percentile(successes, .99);
  const durationOk = elapsedMs >= 300_000;
  const enough = versioned.length >= 100;
  const errorRate = versioned.length === 0 ? null : errors / versioned.length;
  const outcome = !durationOk || !enough || (stable && stableSamples.length === 0) ? "inconcluso" :
    unattributed || errorRate > .01 || p95 === null || p95 > 2000 ? "revertir" : "promover";
  return {
    outcome, elapsedMs, total: samples.length, candidateSamples: versioned.length,
    stableSamples: stableSamples.length, stableErrors: stableSamples.filter(sample => sample.status !== 200).length,
    errors, controlledFailures, unattributed, errorRate, p95, p99
  };
}
