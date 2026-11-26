import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant } from "../src/backend/asistente.mjs";

test("IA-02 e IA-04: el asistente envía solo datos de la consulta elegida y reserva el cupo del día", async () => {
  const reserved = [];
  const sent = [];
  const clock = () => new Date("2026-11-27T03:30:00Z");
  const assistant = createAssistant({
    async takeAssistantRequest(...args) { reserved.push(args); return true; }
  }, {
    clock,
    async complete(...args) {
      sent.push(args);
      return "MediPoli ofrece **medicina general** y **odontología**.";
    }
  });

  await assert.rejects(assistant("pregunta abierta"), { status: 400 });
  assert.deepEqual(reserved, []);
  assert.deepEqual(await assistant("servicios"), {
    respuesta: "MediPoli ofrece medicina general y odontología.",
    fuente: "bedrock"
  });
  assert.deepEqual(reserved, [["2026-11-26", 100, Math.floor(clock().getTime() / 1000) + 172800]]);
  assert.deepEqual(sent, [["¿Qué servicios ofrece MediPoli?", "medicina general y odontología"]]);
});

test("IA-03: el catálogo responde al agotar el cupo, fallar la generación o recibir texto incompleto", async () => {
  let calls = 0;
  let capacity = false;
  const assistant = createAssistant({
    async takeAssistantRequest() { return capacity; }
  }, {
    async complete() {
      calls++;
      if (calls === 1) return "La Sede Norte en Usaquén.";
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

test("IA-02: acepta una frase natural con las tres sedes y comprueba su sector", async () => {
  let answer = "La Sede Norte queda en Usaquén, la Sede Occidente está en Engativá y la Sede Centro está en La Candelaria.";
  const assistant = createAssistant({
    async takeAssistantRequest() { return true; }
  }, {
    async complete() { return answer; }
  });

  assert.deepEqual(await assistant("sedes"), { respuesta: answer, fuente: "bedrock" });
  answer = "Sede Norte en La Candelaria, Sede Occidente en Engativá y Sede Centro en Usaquén.";
  assert.equal((await assistant("sedes")).fuente, "catalogo");
});
