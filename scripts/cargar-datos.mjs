import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDirectory, makePassword } from "../src/backend/identidad.mjs";
import { createDynamoStore } from "../src/backend/dynamodb.mjs";
import { CLINICS, SERVICES, patientSeed, professionalSeed } from "../src/shared/catalogo.mjs";

const { AGENDA_TABLE, USER_POOL_ID, MEDIPOLI_ENV } = process.env;
if (!["dev", "prod"].includes(MEDIPOLI_ENV) || AGENDA_TABLE !== `medipoli-${MEDIPOLI_ENV}-agenda` ||
  !/^[a-z0-9-]+_[a-zA-Z0-9]+$/.test(USER_POOL_ID ?? "")) {
  throw new Error("Proporciona el ambiente, tabla y pool de MediPoli.");
}
const store = createDynamoStore(AGENDA_TABLE);
const directory = createDirectory(USER_POOL_ID, store);
const users = [...professionalSeed, ...patientSeed,
  { alias: "administrador-demo", name: "Administración MediPoli", clinic: "centro", role: "administrador" }];
await mkdir(".work", { recursive: true });
const file = `.work/credentials-${MEDIPOLI_ENV}.json`;
let passwords = {};
try {
  passwords = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (const profile of users) passwords[profile.alias] ??= makePassword();
await writeFile(file, JSON.stringify(passwords, null, 2), { mode: 0o600 });
let created = 0;
for (const profile of users) {
  const { created: fresh } = await directory.ensure(profile, passwords[profile.alias], { allowExisting: true, permanent: true });
  if (fresh) created++;
}
console.log(JSON.stringify({ clinics: CLINICS.length, services: Object.keys(SERVICES).length,
  professionals: professionalSeed.length, patients: patientSeed.length, created, utc: new Date().toISOString() }));
