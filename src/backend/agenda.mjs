import { createHash, randomUUID } from "node:crypto";
import { CLINICS, SERVICES } from "../shared/catalogo.mjs";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class StoreConflict extends Error {}

export function requireRole(actor, ...allowed) {
  if (!actor?.id) throw new HttpError(401, "Inicia sesión para continuar.");
  if (!allowed.includes(actor.role)) throw new HttpError(403, "Tu rol no permite esta operación.");
}

function validateId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9:_.#-]{1,160}$/.test(id)) {
    throw new HttpError(400, "Identificador inválido.");
  }
  return id;
}

function validateDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, "Fecha inválida.");
  const parsed = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, "Fecha inválida.");
  }
}

function clinicExists(id) {
  return CLINICS.some(clinic => clinic.id === id);
}

function slotView(slot) {
  const { id, starts, clinic, service, professionalId, professionalName } = slot;
  return { id, starts, clinic, service, professionalId, professionalName };
}

function appointmentView(item) {
  const { id, slotId, starts, clinic, service, professionalName, status, revision } = item;
  return { id, slotId, starts, clinic, service, professionalName, status, revision };
}

export function createAgenda(store, { clock = Date.now, makeId = randomUUID } = {}) {
  async function availability(actor, { date, service, clinic }) {
    requireRole(actor, "paciente");
    validateDate(date);
    if (!Object.hasOwn(SERVICES, service) || (clinic && !clinicExists(clinic))) {
      throw new HttpError(400, "Selecciona una sede o servicio disponible.");
    }
    const now = new Date(clock()).toISOString();
    const slots = await store.query("availability", `${date}#${service}`, now);
    return slots.filter(slot => slot.status === "AVAILABLE" && (!clinic || slot.clinic === clinic))
      .map(slotView);
  }

  async function ownAppointments(actor) {
    requireRole(actor, "paciente", "profesional");
    return (actor.role === "paciente"
      ? await store.query("patient", actor.id)
      : await store.query("professional", actor.professionalId)).map(appointmentView);
  }

  function findReplay(previous, hash) {
    if (!previous) return undefined;
    if (previous.hash !== hash) throw new HttpError(409, "Esta clave de solicitud ya se usó para otros datos.");
    return previous.result;
  }

  async function request(actor, key, payload, build) {
    requireRole(actor, "paciente");
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) {
      throw new HttpError(400, "Proporciona una clave de idempotencia válida.");
    }
    const pk = `REQUEST#${actor.id}#${key}`;
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const previous = findReplay(await store.get(pk), hash);
    if (previous) return previous;
    try {
      const { actions, result } = await build();
      await store.atomic([...actions, {
        item: { pk, entity: "REQUEST", hash, result, expiresAt: Math.floor(clock() / 1000) + 86400 },
        condition: { absent: true }
      }]);
      return result;
    } catch (error) {
      // Una recarga resuelve la carrera entre reintentos, incluso si el segundo leyó
      // la cita o franja después de que el primero ya había aplicado la transacción.
      if (error instanceof StoreConflict || error instanceof HttpError && [404, 409].includes(error.status)) {
        const replay = findReplay(await store.get(pk), hash);
        if (replay) return replay;
      }
      if (error instanceof StoreConflict) {
        throw new HttpError(409, "La disponibilidad o la cita cambió. Actualiza la agenda.");
      }
      throw error;
    }
  }

  async function getOpenSlot(id, now) {
    const slot = await store.get(`SLOT#${validateId(id)}`);
    if (!slot || slot.status !== "AVAILABLE" || Date.parse(slot.starts) <= now) {
      throw new HttpError(409, "La franja ya no está disponible.");
    }
    return slot;
  }

  async function getOwnFutureAppointment(actor, id, now) {
    const found = await store.get(`APT#${validateId(id)}`);
    if (!found || found.patient !== actor.id) throw new HttpError(404, "No se encontró la cita.");
    if (found.status !== "BOOKED" || Date.parse(found.starts) <= now) {
      throw new HttpError(409, "Solo puedes modificar una cita futura confirmada.");
    }
    return found;
  }

  function occupy(slot, id) {
    return { item: { ...slot, status: "BOOKED", appointmentId: id }, condition: { equal: { status: "AVAILABLE" } } };
  }

  async function release(appointment) {
    const slot = await store.get(`SLOT#${appointment.slotId}`);
    if (!slot || slot.appointmentId !== appointment.id) throw new HttpError(409, "La franja cambió.");
    const { appointmentId: _owner, ...remaining } = slot;
    return { item: { ...remaining, status: "AVAILABLE" }, condition: { equal: { appointmentId: appointment.id } } };
  }

  function guardKey(actor, service) {
    return `ACTIVE#${actor.id}#${service}`;
  }

  function guard(appointment, condition) {
    return {
      item: {
        pk: guardKey({ id: appointment.patient }, appointment.service),
        entity: "GUARD",
        startsEpoch: Date.parse(appointment.starts),
        appointmentId: appointment.id
      },
      condition
    };
  }

  async function book(actor, slotId, key, requestId) {
    return request(actor, key, ["book", slotId], async () => {
      const now = clock();
      const slot = await getOpenSlot(slotId, now);
      const id = makeId();
      const appointment = {
        pk: `APT#${id}`, id, entity: "APPOINTMENT", patient: actor.id,
        professional: slot.professionalId, professionalName: slot.professionalName,
        slotId: slot.id, starts: slot.starts, clinic: slot.clinic, service: slot.service,
        status: "BOOKED", revision: 1, eventType: "CitaReservada",
        changedAt: new Date(now).toISOString(), requestId
      };
      return {
        actions: [
          occupy(slot, id),
          guard(appointment, { absentOrExpired: now }),
          { item: appointment, condition: { absent: true } }
        ],
        result: appointmentView(appointment)
      };
    });
  }

  async function cancel(actor, appointmentId, key, requestId) {
    return request(actor, key, ["cancel", appointmentId], async () => {
      const now = clock();
      const current = await getOwnFutureAppointment(actor, appointmentId, now);
      const changed = { ...current, status: "CANCELLED", revision: current.revision + 1, eventType: "CitaCancelada", changedAt: new Date(now).toISOString(), requestId };
      return {
        actions: [
          await release(current),
          { deleteKey: guardKey(actor, current.service), condition: { equal: { appointmentId: current.id } } },
          { item: changed, condition: { equal: { revision: current.revision, status: "BOOKED", patient: actor.id } } }
        ],
        result: appointmentView(changed)
      };
    });
  }

  async function reschedule(actor, appointmentId, slotId, key, requestId) {
    return request(actor, key, ["reschedule", appointmentId, slotId], async () => {
      const now = clock();
      const current = await getOwnFutureAppointment(actor, appointmentId, now);
      const next = await getOpenSlot(slotId, now);
      if (next.service !== current.service) throw new HttpError(409, "La nueva franja debe ser del mismo servicio.");
      const changed = {
        ...current, slotId: next.id, starts: next.starts, clinic: next.clinic,
        professional: next.professionalId, professionalName: next.professionalName,
        revision: current.revision + 1, changedAt: new Date(now).toISOString(),
        eventType: "CitaReprogramada", requestId
      };
      return {
        actions: [
          occupy(next, current.id), await release(current),
          guard(changed, { equal: { appointmentId: current.id } }),
          { item: changed, condition: { equal: { revision: current.revision, status: "BOOKED", patient: actor.id } } }
        ],
        result: appointmentView(changed)
      };
    });
  }

  async function report(actor) {
    requireRole(actor, "administrador");
    const groups = new Map();
    for (const { clinic, service, status } of await store.listAppointments()) {
      const key = [clinic, service, status].join("#");
      const value = groups.get(key) ?? { clinic, service, status, total: 0 };
      value.total++;
      groups.set(key, value);
    }
    return [...groups.values()];
  }

  return { availability, ownAppointments, book, cancel, reschedule, report };
}
