import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgenda } from "../src/backend/agenda.mjs";
import { CLINICS, SERVICES, patientSeed, professionalSeed } from "../src/shared/catalogo.mjs";
import { admin, memoryStore, patientA, patientB, slot, testDate, testHour, testSlots } from "./fixtures.mjs";

function setup() {
  const store = memoryStore(testSlots);
  return { store, agenda: createAgenda(store, { clock: () => testHour }) };
}

test("P-01: tres sedes y dos servicios, con cinco profesionales y veinte pacientes por sede", () => {
  assert.equal(CLINICS.length, 3);
  assert.equal(Object.keys(SERVICES).length, 2);
  for (const clinic of CLINICS) {
    assert.equal(professionalSeed.filter(user => user.clinic === clinic.id).length, 5);
    assert.equal(patientSeed.filter(user => user.clinic === clinic.id).length, 20);
  }
  assert.equal(new Set(testSlots.map(item => item.id)).size, testSlots.length);
});

test("P-03: filtra por sede y servicio y omite las franjas ocupadas", async () => {
  const { agenda } = setup();
  const filter = { date: testDate, service: "medicina-general", clinic: "centro" };
  const first = await agenda.availability(patientA, filter);
  assert.equal(first.length, 18);
  await agenda.book(patientA, first[0].id, "request_00001", "trace-a");
  assert.equal((await agenda.availability(patientB, filter)).length, 17);
});

test("P-04: ante dos pacientes y una franja, solo una reserva queda confirmada", async () => {
  const { agenda, store } = setup();
  const result = await Promise.allSettled([
    agenda.book(patientA, slot(), "request_00002", "trace-a"),
    agenda.book(patientB, slot(), "request_00003", "trace-b")
  ]);
  assert.equal(result.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(result.find(item => item.status === "rejected").reason.status, 409);
  assert.equal((await store.listAppointments()).length, 1);
});

test("P-04: el cupo por servicio se aplica entre sedes; permite otro servicio", async () => {
  const { agenda } = setup();
  const first = await agenda.book(patientA, slot(), "request_00004", "trace-a");
  const otherClinic = testSlots.find(item => item.clinic !== first.clinic && item.service === first.service);
  await assert.rejects(agenda.book(patientA, otherClinic.id, "request_00005"), { status: 409 });
  const otherService = testSlots.find(item => item.service !== first.service);
  await agenda.book(patientA, otherService.id, "request_00006");
  assert.equal((await agenda.ownAppointments(patientA)).length, 2);
});

test("P-04: un reintento simultáneo con la misma clave devuelve la misma cita", async () => {
  const { agenda, store } = setup();
  const two = await Promise.all([
    agenda.book(patientA, slot(), "request_00007", "trace-a"),
    agenda.book(patientA, slot(), "request_00007", "trace-b")
  ]);
  assert.equal(two[0].id, two[1].id);
  assert.equal((await store.listAppointments()).length, 1);
  await assert.rejects(agenda.book(patientA, slot(1), "request_00007"), { status: 409 });
});

test("P-05 y P-07: solo el paciente dueño puede cancelar y liberar su franja", async () => {
  const { agenda, store } = setup();
  const appointment = await agenda.book(patientA, slot(), "request_00008");
  assert.deepEqual(await agenda.ownAppointments(patientB), []);
  await assert.rejects(agenda.cancel(patientB, appointment.id, "request_00009"), { status: 404 });
  const cancelled = await agenda.cancel(patientA, appointment.id, "request_00010");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await store.get("SLOT#" + slot())).status, "AVAILABLE");
  await agenda.book(patientA, slot(1), "request_00011");
});

test("P-06: si la franja nueva no está disponible no se pierde la anterior", async () => {
  const { agenda, store } = setup();
  const original = await agenda.book(patientA, slot(), "request_00012");
  await agenda.book(patientB, slot(1), "request_00013");
  await assert.rejects(agenda.reschedule(patientA, original.id, slot(1), "request_00014"), { status: 409 });
  assert.equal((await store.get("APT#" + original.id)).slotId, original.slotId);
  assert.equal((await store.get("SLOT#" + slot())).appointmentId, original.id);
  const moved = await agenda.reschedule(patientA, original.id, slot(2), "request_00015");
  assert.equal(moved.id, original.id);
  assert.equal(moved.revision, 2);
  assert.equal((await store.get("SLOT#" + original.slotId)).status, "AVAILABLE");
});

test("P-07 y P-08: el profesional ve su agenda y la administración obtiene solo conteos", async () => {
  const { agenda } = setup();
  const appointment = await agenda.book(patientA, slot(), "request_00016");
  const professional = { id: "prof-a", role: "profesional", professionalId: testSlots[0].professionalId };
  assert.equal((await agenda.ownAppointments(professional))[0].id, appointment.id);
  assert.deepEqual(await agenda.ownAppointments({ ...professional, professionalId: "otro" }), []);
  await assert.rejects(agenda.book(professional, slot(1), "request_00017"), { status: 403 });
  await assert.rejects(agenda.report(patientA), { status: 403 });
  assert.deepEqual(await agenda.report(admin), [{ clinic: appointment.clinic, service: appointment.service, status: "BOOKED", total: 1 }]);
});
