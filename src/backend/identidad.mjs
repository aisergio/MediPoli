import { randomBytes, randomUUID } from "node:crypto";
import { AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { CLINICS, SERVICES, schedule } from "../shared/catalogo.mjs";
import { HttpError } from "./agenda.mjs";

export function makePassword() {
  return `Aa9!${randomBytes(21).toString("base64url")}`;
}

export function validateProfile(input) {
  const alias = String(input.alias ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const { role, clinic, service } = input;
  const safeName = /^[\p{L}\p{N}][\p{L}\p{N} .·'’-]{2,79}$/u.test(name);
  if (!/^[a-z][a-z0-9-]{3,45}$/.test(alias) || !safeName ||
    !CLINICS.some(item => item.id === clinic) || !["paciente", "profesional"].includes(role) ||
    (role === "profesional" && !Object.hasOwn(SERVICES, service))) {
    throw new HttpError(400, "Completa un alias, nombre ficticio, sede y rol válidos.");
  }
  return { alias, name, role, clinic, ...(role === "profesional" ? { service, professionalId: "p-" + randomUUID() } : {}) };
}

export function createDirectory(pool, store, client = new CognitoIdentityProviderClient({ maxAttempts: 3 })) {
  async function ensure(profile, password, { allowExisting = false, permanent = false } = {}) {
    let user;
    let created = false;
    try {
      const result = await client.send(new AdminCreateUserCommand({
        UserPoolId: pool,
        Username: profile.alias,
        TemporaryPassword: password,
        MessageAction: "SUPPRESS",
        UserAttributes: [{ Name: "name", Value: profile.name }]
      }));
      user = result.User?.Attributes;
      created = true;
    } catch (error) {
      if (error.name !== "UsernameExistsException") throw error;
      if (!allowExisting) throw new HttpError(409, "El alias ya está en uso.");
      user = (await client.send(new AdminGetUserCommand({ UserPoolId: pool, Username: profile.alias }))).UserAttributes;
    }
    const sub = user?.find(({ Name }) => Name === "sub")?.Value;
    if (!sub) throw new Error("Cognito no devolvió el sujeto del usuario.");
    if (permanent && created) await client.send(new AdminSetUserPasswordCommand({
      UserPoolId: pool, Username: profile.alias, Password: password, Permanent: true
    }));
    const item = { pk: `PROFILE#${sub}`, entity: "PROFILE", ...profile };
    const written = await store.create(item);
    const saved = written ? item : await store.get(item.pk);
    if (saved.role !== profile.role || saved.clinic !== profile.clinic ||
      (saved.role === "profesional" && saved.service !== profile.service)) {
      throw new HttpError(409, "El alias existente tiene otro perfil.");
    }
    if (saved.role === "profesional") {
      const slots = schedule(saved);
      for (let offset = 0; offset < slots.length; offset += 10) {
        await Promise.all(slots.slice(offset, offset + 10).map(slot => store.create(slot)));
      }
    }
    return { sub, created, profile: saved };
  }
  return { ensure };
}
