import { fromEnv } from "@aws-sdk/credential-provider-env";
import { Sha256 } from "@smithy/core/checksum";
import { SignatureV4 } from "@smithy/signature-v4";
import { ASSISTANT_QUERIES, CLINICS, SERVICES, dateBogota } from "../shared/catalogo.mjs";
import { HttpError } from "./agenda.mjs";

const list = new Intl.ListFormat("es-CO", { type: "conjunction" });
const facts = {
  sedes: CLINICS.map(({ name, sector }) => `${name} en ${sector}`),
  servicios: Object.values(SERVICES).map(name => name.toLowerCase())
};
const introductions = {
  sedes: "Las sedes de MediPoli son",
  servicios: "En MediPoli ofrecemos"
};
const dailyLimit = 100;

function matchesCatalog(query, text) {
  const normalized = text.toLowerCase();
  if (query === "servicios") return facts.servicios.every(service => normalized.includes(service));
  const locations = CLINICS.map(({ name, sector }) => ({
    start: normalized.indexOf(name.toLowerCase()),
    sector: sector.toLowerCase()
  })).sort((a, b) => a.start - b.start);
  return locations.every(({ start, sector }, index) =>
    start >= 0 && normalized.slice(start, locations[index + 1]?.start).includes(sector));
}

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
          content: `MediPoli es una IPS ficticia. Responde con una frase breve en español usando este catálogo. ${catalog}. Si mencionas sedes, escribe cada sede seguida de su sector.`
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
    return choices?.[0]?.finish_reason === "stop" ? choices[0].message?.content : null;
  };
}

export function createAssistant(store, { region, complete = bedrockCompleter(region), clock = () => new Date() }) {
  return async function answer(query) {
    if (typeof query !== "string" || !Object.hasOwn(ASSISTANT_QUERIES, query)) {
      throw new HttpError(400, "Elige una de las consultas del asistente.");
    }
    const entries = facts[query];
    const catalog = list.format(entries);
    const fallback = { respuesta: `${introductions[query]} ${catalog}.`, fuente: "catalogo" };
    const now = clock();
    try {
      const accepted = await store.takeAssistantRequest(dateBogota(now), dailyLimit, Math.floor(now.getTime() / 1000) + 172800);
      if (!accepted) return fallback;
      const answer = await complete(ASSISTANT_QUERIES[query], catalog);
      const text = typeof answer === "string" ? answer.replace(/\s+/g, " ").trim() : "";
      if (text.length <= 500 && matchesCatalog(query, text)) {
        return { respuesta: text, fuente: "bedrock" };
      }
    } catch {
      return fallback;
    }
    return fallback;
  };
}
