import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { HttpError } from "./agenda.mjs";

function toolResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function caller(scopes, scope, action) {
  return async (input) => {
    try {
      if (!scopes.includes(scope)) throw new HttpError(403, "El permiso OAuth no autoriza esta herramienta.");
      return toolResult(await action(input));
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return { ...toolResult({ error: error.message, status: error.status }), isError: true };
    }
  };
}

export async function handleMcp(request, { actor, agenda, requestId, resource, grants }) {
  const server = new McpServer({ name: "medipoli-citas", version: "1.0.0" });
  const read = `${resource}/read`;
  const write = `${resource}/reserve`;
  const readHints = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
  server.registerTool("consultar_disponibilidad", {
    title: "Consultar disponibilidad",
    description: "Lista franjas de medicina general u odontología en una fecha de Bogotá.",
    inputSchema: { date: z.string(), service: z.enum(["medicina-general", "odontologia"]), clinic: z.enum(["centro", "norte", "occidente"]).optional() },
    annotations: readHints
  }, caller(grants, read, input => agenda.availability(actor, input)));
  server.registerTool("consultar_mis_citas", {
    title: "Consultar mis citas",
    description: "Devuelve las citas asociadas a la cuenta autenticada.",
    inputSchema: {},
    annotations: readHints
  }, caller(grants, read, () => agenda.ownAppointments(actor)));
  server.registerTool("reservar_cita", {
    title: "Reservar cita",
    description: "Pide al paciente que confirme servicio, sede y horario antes de llamar con confirmada=true. Reutiliza la misma clave en un reintento.",
    inputSchema: { slotId: z.string(), confirmada: z.boolean(), clave: z.string().min(8).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true }
  }, caller(grants, write, async ({ slotId, confirmada, clave }) => {
    if (!confirmada) throw new HttpError(400, "La reserva requiere confirmación del paciente.");
    return agenda.book(actor, slotId, clave, requestId);
  }));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return { statusCode: response.status, headers: { ...Object.fromEntries(response.headers), "cache-control": "no-store" }, body: await response.text() };
  } finally {
    await server.close();
  }
}
