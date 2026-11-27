import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant } from "../src/backend/asistente.mjs";

test("IA-02 e IA-04: el asistente envía el catálogo institucional y reserva el cupo del día", async () => {
  const reserved = [];
  const sent = [];
  const clock = () => new Date("2026-11-27T03:30:00Z");
  const assistant = createAssistant({
    async takeAssistantRequest(...args) { reserved.push(args); return true; }
  }, {
    clock,
    async complete(...args) {
      sent.push(args);
      return ["medicina-general", "odontologia"];
    }
  });

  await assert.rejects(assistant("pregunta abierta"), { status: 400 });
  assert.deepEqual(reserved, []);
  assert.deepEqual(await assistant("servicios"), {
    respuesta: "En MediPoli ofrecemos medicina general y odontología.",
    fuente: "bedrock"
  });
  assert.deepEqual(reserved, [["2026-11-26", 100, Math.floor(clock().getTime() / 1000) + 172800]]);
  assert.deepEqual(sent, [["¿Qué servicios ofrece MediPoli?", {
    sedes: {
      centro: "Sede Centro en La Candelaria",
      norte: "Sede Norte en Usaquén",
      occidente: "Sede Occidente en Engativá"
    },
    servicios: { "medicina-general": "medicina general", odontologia: "odontología" }
  }]]);
});

test("IA-03: el catálogo responde al agotar el cupo, fallar la generación o recibir una selección incompleta", async () => {
  let calls = 0;
  let capacity = false;
  const assistant = createAssistant({
    async takeAssistantRequest() { return capacity; }
  }, {
    async complete() {
      calls++;
      if (calls === 1) return ["norte"];
      throw new Error("El proveedor agotó su tiempo de respuesta.");
    }
  });
  const expected = {
    respuesta: "Las sedes de MediPoli son Sede Centro en La Candelaria, Sede Norte en Usaquén y Sede Occidente en Engativá.",
    fuente: "catalogo"
  };
  assert.deepEqual(await assistant("sedes"), expected);
  assert.equal(calls, 0);
  capacity = true;
  assert.deepEqual(await assistant("sedes"), expected);
  assert.deepEqual(await assistant("sedes"), expected);
  assert.equal(calls, 2);
});

test("IA-02: construye el texto del catálogo y rechaza referencias inventadas, ajenas y repetidas", async () => {
  let selected = ["norte", "occidente", "centro"];
  const assistant = createAssistant({
    async takeAssistantRequest() { return true; }
  }, {
    async complete() { return selected; }
  });

  assert.deepEqual(await assistant("sedes"), {
    respuesta: "Las sedes de MediPoli son Sede Norte en Usaquén, Sede Occidente en Engativá y Sede Centro en La Candelaria.",
    fuente: "bedrock"
  });
  for (const invalid of [["sede-central", "odontologia"], ["centro", "odontologia"], ["odontologia", "odontologia"]]) {
    selected = invalid;
    assert.deepEqual(await assistant("servicios"), {
      respuesta: "En MediPoli ofrecemos medicina general y odontología.",
      fuente: "catalogo"
    });
  }
});
