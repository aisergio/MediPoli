import { CognitoJwtVerifier } from "aws-jwt-verify";
import { createAgenda, HttpError, requireRole } from "./agenda.mjs";
import { createDynamoStore } from "./dynamodb.mjs";
import { createDirectory, makePassword, validateProfile } from "./identidad.mjs";
import { handleMcp } from "./mcp.mjs";

function json(statusCode, value, headers = {}) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }, body: JSON.stringify(value) };
}

function bodyFor(event) {
  const body = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body ?? "";
  if (Buffer.byteLength(body) > 24000) throw new HttpError(413, "Solicitud demasiado grande.");
  return body;
}

function jsonBody(event) {
  try {
    const body = JSON.parse(bodyFor(event));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("object required");
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Envía un objeto JSON válido.");
  }
}

export function createApi({ store, agenda, directory, mcpVerifier, publicOrigin, issuer, webScope, allowedOrigins }) {
  const resource = `${publicOrigin}/MediPoli/mcp`;
  const metadata = "/.well-known/oauth-protected-resource/MediPoli/mcp";
  const read = `${resource}/read`;
  const write = `${resource}/reserve`;

  async function actorFrom(sub) {
    if (!sub) throw new HttpError(401, "Inicia sesión para continuar.");
    const profile = await store.get(`PROFILE#${sub}`);
    if (!profile) throw new HttpError(403, "Esta cuenta no tiene un perfil habilitado.");
    return { id: sub, role: profile.role, professionalId: profile.professionalId, name: profile.name };
  }

  return async function api(event, context) {
    const start = performance.now();
    const requestId = event.requestContext?.requestId ?? context.awsRequestId;
    const version = context.functionVersion ?? "$LOCAL";
    const method = event.requestContext?.http?.method;
    const path = event.rawPath?.replace(/\/$/, "");
    const headers = event.headers ?? {};
    const key = headers["idempotency-key"];
    let route = "not-found";
    async function respond() {
      if (method === "GET" && ["/MediPoli/api/health", "/MediPoli/api/candidate-health"].includes(path)) {
        route = "health";
        return json(200, { ok: true, release: version });
      }
      if (method === "GET" && path === metadata) {
        route = "mcp-metadata";
        return json(200, { resource, authorization_servers: [issuer], scopes_supported: [read, write], bearer_methods_supported: ["header"] });
      }
      if (path === "/MediPoli/mcp") {
        route = "mcp";
        if (headers.origin && !allowedOrigins.includes(headers.origin)) throw new HttpError(403, "Origen no autorizado.");
        if (method !== "POST") return json(405, { error: "El transporte usa POST." }, { allow: "POST" });
        let claims;
        try {
          const match = /^Bearer (.+)$/i.exec(headers.authorization ?? "");
          if (!match || !mcpVerifier) throw new Error("no bearer");
          claims = await mcpVerifier.verify(match[1]);
          const audiences = [].concat(claims.aud ?? []);
          if (!audiences.includes(resource)) throw new Error("audience");
        } catch {
          return json(401, { error: "Autoriza la cuenta del paciente." }, {
            "www-authenticate": `Bearer resource_metadata="${publicOrigin}${metadata}", scope="${read} ${write}"`
          });
        }
        const actor = await actorFrom(claims.sub);
        requireRole(actor, "paciente");
        const request = new Request(resource, { method: "POST", headers, body: bodyFor(event) });
        return handleMcp(request, { actor, agenda, requestId, resource, grants: (claims.scope ?? "").split(" ") });
      }
      if (!path?.startsWith("/MediPoli/api/")) throw new HttpError(404, "Ruta no disponible.");
      const claims = event.requestContext?.authorizer?.jwt?.claims;
      if (claims?.token_use !== "access" || !String(claims.scope ?? "").split(" ").includes(webScope)) {
        throw new HttpError(401, "Se requiere un token de acceso de MediPoli.");
      }
      const actor = await actorFrom(claims.sub);
      const operation = path.slice("/MediPoli/api/".length);
      if (method === "GET" && operation === "perfil") {
        route = "profile";
        return json(200, { role: actor.role, name: actor.name });
      }
      if (method === "GET" && operation === "disponibilidad") {
        route = "availability";
        return json(200, await agenda.availability(actor, event.queryStringParameters ?? {}));
      }
      if (operation === "citas" && method === "GET") {
        route = "own-appointments";
        return json(200, await agenda.ownAppointments(actor));
      }
      if (operation === "citas" && method === "POST") {
        route = "book";
        return json(201, await agenda.book(actor, jsonBody(event).slotId, key, requestId));
      }
      const mutation = /^(?:citas)\/([a-zA-Z0-9-]+)\/(cancelar|reprogramar)$/.exec(operation);
      if (method === "POST" && mutation) {
        route = mutation[2] === "cancelar" ? "cancel" : "reschedule";
        const updated = route === "cancel"
          ? await agenda.cancel(actor, mutation[1], key, requestId)
          : await agenda.reschedule(actor, mutation[1], jsonBody(event).slotId, key, requestId);
        return json(200, updated);
      }
      if (method === "GET" && operation === "admin/reportes") {
        route = "report";
        return json(200, await agenda.report(actor));
      }
      if (method === "POST" && operation === "admin/altas") {
        route = "provision-demo-user";
        requireRole(actor, "administrador");
        const profile = validateProfile(jsonBody(event));
        const password = makePassword();
        await directory.ensure(profile, password);
        return json(201, { alias: profile.alias, temporaryPassword: password });
      }
      throw new HttpError(404, "Ruta no disponible.");
    }

    let response;
    try {
      response = await respond();
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      response = json(status, { error: status === 500 ? "No se pudo completar la operación." : error.message, requestId });
    }
    response.headers["x-medipoli-version"] = version;
    response.headers["x-request-id"] = requestId;
    console.log(JSON.stringify({
      requestId, route, method, status: response.statusCode,
      durationMs: Math.round(performance.now() - start), version
    }));
    return response;
  };
}

let app;
export async function handler(event, context) {
  if (!app) {
    const store = createDynamoStore(process.env.AGENDA_TABLE);
    const pool = process.env.USER_POOL_ID;
    const mcpVerifier = process.env.MCP_CLIENT_ID
      ? CognitoJwtVerifier.create({ userPoolId: pool, tokenUse: "access", clientId: process.env.MCP_CLIENT_ID })
      : null;
    app = createApi({
      store, agenda: createAgenda(store), directory: createDirectory(pool, store), mcpVerifier,
      publicOrigin: process.env.PUBLIC_ORIGIN, issuer: process.env.OAUTH_ISSUER,
      webScope: process.env.WEB_SCOPE, allowedOrigins: process.env.MCP_ALLOWED_ORIGINS.split(",")
    });
  }
  return app(event, context);
}
