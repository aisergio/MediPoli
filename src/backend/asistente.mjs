import { fromEnv } from "@aws-sdk/credential-provider-env";
import { Sha256 } from "@smithy/core/checksum";
import { SignatureV4 } from "@smithy/signature-v4";
import { ASSISTANT_QUERIES, CLINICS, SERVICES, dateBogota } from "../shared/catalogo.mjs";
import { HttpError } from "./agenda.mjs";

const list = new Intl.ListFormat("es-CO", { type: "conjunction" });
const facts = {
  sedes: Object.fromEntries(CLINICS.map(({ id, name, sector }) => [id, `${name} en ${sector}`])),
  servicios: Object.fromEntries(Object.entries(SERVICES).map(([id, name]) => [id, name.toLowerCase()]))
};
const introductions = {
  sedes: "Las sedes de MediPoli son",
  servicios: "En MediPoli ofrecemos"
};
const dailyLimit = 100;

function bedrockCompleter(region) {
  const host = `bedrock-mantle.${region}.api.aws`;
  const path = "/v1/chat/completions";
  const signer = new SignatureV4({ credentials: fromEnv(), region, service: "bedrock-mantle", sha256: Sha256 });

  return async function complete(question, catalog) {
    const body = JSON.stringify({
      model: "openai.gpt-oss-20b",
      messages: [
        {
          role: "system",
          content: `Elige todas las entradas del catálogo de la IPS ficticia MediPoli que corresponden a la pregunta. Devuelve únicamente un objeto JSON con la propiedad "ids", que contiene los identificadores del catálogo como cadenas. Elige una sola categoría y usa sus identificadores exactos. Catálogo ${JSON.stringify(catalog)}.`
        },
        { role: "user", content: question }
      ],
      reasoning_effort: "low",
      max_completion_tokens: 192,
      stream: false
    });
    const signed = await signer.sign({
      protocol: "https:", hostname: host, method: "POST", path,
      headers: { host, "content-type": "application/json" }, body
    });
    const response = await fetch(`https://${host}${path}`, {
      method: "POST", headers: signed.headers, body, signal: AbortSignal.timeout(5500), redirect: "error"
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const { choices } = await response.json();
    const choice = choices?.[0];
    if (choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string") return null;
    const content = choice.message.content.trim();
    const json = content.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? content;
    return JSON.parse(json)?.ids;
  };
}

export function createAssistant(store, { region, complete = bedrockCompleter(region), clock = () => new Date() }) {
  return async function answer(query) {
    if (typeof query !== "string" || !Object.hasOwn(ASSISTANT_QUERIES, query)) {
      throw new HttpError(400, "Elige una de las consultas del asistente.");
    }
    const entries = facts[query];
    const ids = Object.keys(entries);
    const format = selected => `${introductions[query]} ${list.format(selected.map(id => entries[id]))}.`;
    const fallback = { respuesta: format(ids), fuente: "catalogo" };
    const now = clock();
    try {
      const accepted = await store.takeAssistantRequest(dateBogota(now), dailyLimit, Math.floor(now.getTime() / 1000) + 172800);
      if (!accepted) return fallback;
      const selected = await complete(ASSISTANT_QUERIES[query], facts);
      if (Array.isArray(selected) && selected.length === ids.length && new Set(selected).size === ids.length &&
        selected.every(id => typeof id === "string" && Object.hasOwn(entries, id))) {
        return { respuesta: format(selected), fuente: "bedrock" };
      }
    } catch {
      return fallback;
    }
    return fallback;
  };
}
