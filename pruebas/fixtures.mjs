import { StoreConflict } from "../src/backend/agenda.mjs";
import { professionalSeed, schedule } from "../src/shared/catalogo.mjs";

export function memoryStore(initial = []) {
  const items = new Map(initial.map(item => [item.pk, structuredClone(item)]));
  return {
    async get(pk) { return structuredClone(items.get(pk)); },
    async query(field, value, after = "") {
      return [...items.values()]
        .filter(item => item[field] === value && item.starts > after)
        .sort((a, b) => a.starts.localeCompare(b.starts))
        .map(item => structuredClone(item));
    },
    async listAppointments() {
      return [...items.values()].filter(item => item.entity === "APPOINTMENT").map(item => structuredClone(item));
    },
    async create(item) {
      if (items.has(item.pk)) return false;
      items.set(item.pk, structuredClone(item));
      return true;
    },
    async atomic(operations) {
      for (const { item, deleteKey, condition } of operations) {
        const old = items.get(item?.pk ?? deleteKey);
        let valid;
        if (condition.absent) valid = !old;
        else if (condition.absentOrExpired !== undefined) valid = !old || old.startsEpoch <= condition.absentOrExpired;
        else valid = old && Object.entries(condition.equal).every(([key, value]) => old[key] === value);
        if (!valid) throw new StoreConflict();
      }
      for (const { item, deleteKey } of operations) {
        if (item) items.set(item.pk, structuredClone(item));
        else items.delete(deleteKey);
      }
    }
  };
}

export const testDate = "2026-11-19";
export const testHour = Date.parse("2026-11-19T12:50:00Z");
export const testSlots = professionalSeed.flatMap(profile => schedule(profile, testDate, 1));
export const patientA = { id: "paciente-a", role: "paciente" };
export const patientB = { id: "paciente-b", role: "paciente" };
export const admin = { id: "admin", role: "administrador" };
export const slot = (index = 0) => testSlots[index].id;
