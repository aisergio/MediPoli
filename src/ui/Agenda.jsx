import { useEffect, useRef, useState } from "react";
import { CLINICS, SERVICES, dateBogota } from "../shared/catalogo.mjs";

const statusName = { BOOKED: "Confirmada", CANCELLED: "Cancelada" };
const formatter = new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" });
const clinicName = id => CLINICS.find(clinic => clinic.id === id)?.name ?? id;
const cleanLabel = item => `${SERVICES[item.service]} · ${clinicName(item.clinic)} · ${formatter.format(new Date(item.starts))}`;

function randomBase64() {
  const array = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...array)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signIn(domain, clientId, scope, redirect) {
  const verifier = randomBase64();
  const state = randomBase64();
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...hash)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  sessionStorage.setItem("medipoli-oauth", JSON.stringify({ verifier, state }));
  const params = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirect, scope: "openid " + scope,
    state, code_challenge_method: "S256", code_challenge: challenge
  });
  window.location.assign(`https://${domain}/oauth2/authorize?${params}`);
}

async function completeSignIn(domain, clientId, redirect) {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return sessionStorage.getItem("medipoli-token");
  const prior = JSON.parse(sessionStorage.getItem("medipoli-oauth") ?? "null");
  sessionStorage.removeItem("medipoli-oauth");
  history.replaceState({}, "", redirect);
  if (!prior?.verifier || prior.state !== params.get("state") || params.has("error")) throw new Error("No se verificó la sesión. Vuelve a iniciar sesión.");
  const response = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: params.get("code"), code_verifier: prior.verifier, redirect_uri: redirect })
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) throw new Error("No se completó el inicio de sesión.");
  sessionStorage.setItem("medipoli-token", tokens.access_token);
  return tokens.access_token;
}

export default function Agenda({ base, cognitoDomain, clientId, webScope }) {
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [date, setDate] = useState("");
  const [today, setToday] = useState("");
  const [clinic, setClinic] = useState("");
  const [service, setService] = useState("medicina-general");
  const [slots, setSlots] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [roleInput, setRoleInput] = useState("paciente");
  const [report, setReport] = useState(null);
  const [newLogin, setNewLogin] = useState(null);
  const keyRef = useRef(new Map());
  const confirmRef = useRef(null);
  const endpoint = base + "api/";
  const redirect = typeof window === "undefined" ? "" : `${window.location.origin}${base}agenda/`;
  const configured = cognitoDomain && clientId;

  async function call(path, { method = "GET", body, key, access = token } = {}) {
    const headers = { authorization: `Bearer ${access}` };
    if (method === "POST") headers["content-type"] = "application/json";
    if (key) headers["idempotency-key"] = key;
    const response = await fetch(endpoint + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem("medipoli-token");
        setToken(null);
        setProfile(null);
      }
      const error = new Error(value.error ?? "El servicio no pudo responder.");
      error.status = response.status;
      throw error;
    }
    return value;
  }

  async function run(action) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ type: "error", text: error.message || "No se pudo completar la operación." });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const current = dateBogota();
    setToday(current);
    setDate(current);
    const seat = new URLSearchParams(window.location.search).get("sede");
    if (CLINICS.some(item => item.id === seat)) setClinic(seat);
    if (!configured) return;
    run(async () => {
      const access = await completeSignIn(cognitoDomain, clientId, redirect);
      if (!access) return;
      setToken(access);
      const identity = await call("perfil", { access });
      setProfile(identity);
      if (identity.role !== "administrador") setAppointments(await call("citas", { access }));
    });
  }, []);

  useEffect(() => { if (confirmation) confirmRef.current?.focus(); }, [confirmation]);

  const search = event => {
    event.preventDefault();
    run(async () => {
      setSlots(null);
      setSlots(await call("disponibilidad?" + new URLSearchParams({ date, clinic, service })));
    });
  };

  async function finish() {
    await run(async () => {
      const { action, slot, appointment } = confirmation;
      const operation = JSON.stringify([action, appointment?.id, slot?.id]);
      if (!keyRef.current.has(operation)) keyRef.current.set(operation, crypto.randomUUID());
      const key = keyRef.current.get(operation);
      const path = action === "cancel" ? `citas/${appointment.id}/cancelar`
        : action === "reschedule" ? `citas/${appointment.id}/reprogramar` : "citas";
      try {
        const changed = await call(path, { method: "POST", key, body: slot ? { slotId: slot.id } : {} });
        setAppointments(prev => [...prev.filter(item => item.id !== changed.id), changed].sort((a, b) => a.starts.localeCompare(b.starts)));
        setSlots(prev => prev?.filter(item => item.id !== slot?.id) ?? null);
        setReschedule(null);
        setConfirmation(null);
        setMessage({ type: "success", text: action === "cancel" ? "Cita cancelada." : action === "reschedule" ? "Cita reprogramada." : "Cita confirmada." });
        keyRef.current.delete(operation);
      } catch (error) {
        if (error.status && error.status < 500) keyRef.current.delete(operation);
        throw error;
      }
    });
  }

  function signOut() {
    sessionStorage.removeItem("medipoli-token");
    sessionStorage.removeItem("medipoli-oauth");
    setToken(null);
    setProfile(null);
    setAppointments([]);
    const params = new URLSearchParams({ client_id: clientId, logout_uri: redirect });
    location.assign(`https://${cognitoDomain}/logout?${params}`);
  }

  function addUser(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    run(async () => {
      setNewLogin(null);
      setNewLogin(await call("admin/altas", { method: "POST", body: data }));
    });
  }

  return <div aria-busy={busy}>
    {message && <p className={`notice ${message.type}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p>}
    {!profile && <section className="card sign-in">
      <h2>Acceso con cuenta de demostración</h2>
      <p>Inicia sesión para consultar disponibilidad, revisar tus citas o acceder a tu agenda profesional.</p>
      {configured
        ? <button className="primary" disabled={busy} onClick={() => run(() => signIn(cognitoDomain, clientId, webScope, redirect))}>Iniciar sesión →</button>
        : <p className="notice" role="status">El acceso se habilita al conectar el portal con el entorno de MediPoli.</p>}
    </section>}
    {profile && <>
      <div className="signed-in"><p><strong>{profile.name}</strong> · {profile.role}</p><button className="secondary" onClick={signOut}>Cerrar sesión</button></div>
      {profile.role === "paciente" && <section className="card" aria-labelledby="agenda-buscar">
        <h2 id="agenda-buscar">{reschedule ? "Selecciona una nueva franja" : "Consulta disponibilidad"}</h2>
        {reschedule && <p>{cleanLabel(reschedule)} <button className="secondary" onClick={() => { setReschedule(null); setSlots(null); }}>Salir de reprogramación</button></p>}
        <form onSubmit={search} className="forms">
          <label>Servicio<select value={service} disabled={!!reschedule} onChange={e => { setService(e.target.value); setSlots(null); }}>{Object.entries(SERVICES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Sede<select value={clinic} onChange={e => { setClinic(e.target.value); setSlots(null); }}><option value="">Todas las sedes</option>{CLINICS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Fecha<input type="date" value={date} min={today || undefined} onChange={e => { setDate(e.target.value); setSlots(null); }} required /></label>
          <button className="primary" disabled={busy}>Buscar horarios</button>
        </form>
        {slots && (slots.length ? <ul className="results" aria-label="Franjas disponibles">
          {slots.map(slot => <li key={slot.id}>
            <div><strong>{formatter.format(new Date(slot.starts))}</strong><span>{clinicName(slot.clinic)} · {slot.professionalName}</span></div>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation({ action: reschedule ? "reschedule" : "book", slot, appointment: reschedule })}>{reschedule ? "Elegir" : "Reservar"}</button>
          </li>)}
        </ul> : <p role="status">No encontramos horarios para esa fecha. Prueba otra sede o día.</p>)}
      </section>}
      {confirmation && <section className="card confirmation" aria-labelledby="confirmar" tabIndex={-1} ref={confirmRef}>
        <h2 id="confirmar">{confirmation.action === "cancel" ? "Confirma la cancelación" : "Confirma el horario"}</h2>
        <p>{cleanLabel(confirmation.slot ?? confirmation.appointment)}</p>
        <div className="buttons"><button className="primary" disabled={busy} onClick={finish}>Confirmar</button><button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Volver</button></div>
      </section>}
      {profile.role !== "administrador" && <section className="card" aria-labelledby="mis-citas">
        <div className="section-label"><h2 id="mis-citas">{profile.role === "profesional" ? "Mi agenda profesional" : "Mis citas"}</h2><button className="secondary" onClick={() => run(async () => setAppointments(await call("citas")))} disabled={busy}>Actualizar</button></div>
        {appointments.length ? <ul className="results">
          {appointments.map(item => <li key={item.id}><div><strong>{cleanLabel(item)}</strong><span>{statusName[item.status]} · {item.professionalName}</span></div>
            {profile.role === "paciente" && item.status === "BOOKED" && Date.parse(item.starts) > Date.now() && <div className="buttons">
              <button className="secondary" disabled={busy} onClick={() => { setReschedule(item); setService(item.service); setSlots(null); document.getElementById("agenda-buscar")?.scrollIntoView(); }}>Reprogramar</button>
              <button className="secondary" disabled={busy} onClick={() => setConfirmation({ action: "cancel", appointment: item })}>Cancelar</button>
            </div>}
          </li>)}
        </ul> : <p>Aún no hay citas en esta agenda.</p>}
      </section>}
      {profile.role === "administrador" && <>
        <section className="card">
          <h2>Alta de demostración</h2>
          <form className="forms admin-form" onSubmit={addUser}>
            <label>Tipo de cuenta<select name="role" value={roleInput} onChange={e => setRoleInput(e.target.value)}><option value="paciente">Paciente</option><option value="profesional">Profesional</option></select></label>
            <label>Nombre ficticio<input name="name" required minLength={3} maxLength={80} /></label>
            <label>Alias<input name="alias" required pattern="[a-z][a-z0-9-]{3,45}" /></label>
            <label>Sede<select name="clinic">{CLINICS.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
            {roleInput === "profesional" && <label>Servicio<select name="service">{Object.entries(SERVICES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
            <button className="primary" disabled={busy}>Crear cuenta ficticia</button>
          </form>
          {newLogin && <p className="notice success" role="status">Cuenta {newLogin.alias} creada. Contraseña temporal: <code>{newLogin.temporaryPassword}</code></p>}
        </section>
        <section className="card">
          <div className="section-label"><h2>Conteos de citas</h2><button className="secondary" disabled={busy} onClick={() => run(async () => setReport(await call("admin/reportes")))}>Consultar</button></div>
          {report && (report.length ? <table><thead><tr><th scope="col">Sede</th><th scope="col">Servicio</th><th scope="col">Estado</th><th scope="col">Total</th></tr></thead>
            <tbody>{report.map(row => <tr key={JSON.stringify(row)}><td>{clinicName(row.clinic)}</td><td>{SERVICES[row.service]}</td><td>{statusName[row.status]}</td><td>{row.total}</td></tr>)}</tbody></table> : <p>Todavía no hay citas registradas.</p>)}
        </section>
      </>}
    </>}
  </div>;
}
