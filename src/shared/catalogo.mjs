export const SERVICES = {
  "medicina-general": "Medicina general",
  odontologia: "Odontología"
};

export const CLINICS = [
  { id: "centro", name: "Sede Centro", sector: "La Candelaria" },
  { id: "norte", name: "Sede Norte", sector: "Usaquén" },
  { id: "occidente", name: "Sede Occidente", sector: "Engativá" }
];

export const OT_ZONE = "America/Bogota";
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: OT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
export const dateBogota = (date = new Date()) => localDate.format(date);

export const professionalSeed = CLINICS.flatMap(clinic => Array.from({ length: 5 }, (_, index) => ({
  alias: `profesional-${clinic.id}-${index + 1}`,
  professionalId: `p-${clinic.id}-${index + 1}`,
  name: `Profesional ${index + 1} · ${clinic.name}`,
  role: "profesional",
  clinic: clinic.id,
  service: index < 3 ? "medicina-general" : "odontologia"
})));

export const patientSeed = CLINICS.flatMap(clinic => Array.from({ length: 20 }, (_, index) => ({
  alias: `paciente-${clinic.id}-${index + 1}`,
  name: `Paciente ${index + 1} · ${clinic.name}`,
  role: "paciente",
  clinic: clinic.id
})));

export function schedule(profile, start = dateBogota(), days = 14) {
  const slots = [];
  for (let day = 0; day < days; day++) {
    const at = new Date(`${start}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() + day);
    if ([0, 6].includes(at.getUTCDay())) continue;
    const date = at.toISOString().slice(0, 10);
    for (const hour of [8, 9, 10]) {
      for (const minutes of ["00", "30"]) {
        const starts = new Date(`${date}T${String(hour).padStart(2, "0")}:${minutes}:00-05:00`).toISOString();
        const id = `${profile.professionalId}#${starts}`;
        slots.push({
          pk: `SLOT#${id}`, id, entity: "SLOT", starts, date,
          professionalId: profile.professionalId, professionalName: profile.name,
          clinic: profile.clinic, service: profile.service, status: "AVAILABLE",
          availability: `${date}#${profile.service}`,
          expiresAt: Math.floor(Date.parse(starts) / 1000) + 30 * 86400
        });
      }
    }
  }
  return slots;
}
