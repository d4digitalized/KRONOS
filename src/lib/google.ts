// Google Calendar přes service account s domain-wide delegation.
// POUZE na serveru. Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (PEM,
// \n escapované), GOOGLE_WORKSPACE_DOMAIN (např. "denular.com").
// Server se vydává za uživatele Workspace (sub = jeho e-mail) a pracuje
// s jeho kalendáři, žádné per-user tokeny se neskladují.

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/calendar";
const API = "https://www.googleapis.com/calendar/v3";
const TZ = "Europe/Prague";

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

/** Doména Workspace — jen účty v ní jde impersonovat. */
export function workspaceDomain(): string {
  return process.env.GOOGLE_WORKSPACE_DOMAIN ?? "denular.com";
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** Access token pro jednání jménem uživatele (JWT bearer flow). */
async function accessToken(userEmail: string): Promise<string> {
  const iss = process.env.GOOGLE_SA_EMAIL!;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss,
      sub: userEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const assertion = `${header}.${payload}.${signer.sign(key, "base64url")}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`google token ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).access_token as string;
}

async function gfetch(
  userEmail: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const token = await accessToken(userEmail);
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Založí uživateli sekundární kalendář „Kronos" a vrátí jeho id. */
export async function createKronosCalendar(userEmail: string): Promise<string> {
  const res = await gfetch(userEmail, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Kronos", timeZone: TZ }),
  });
  if (!res.ok) {
    throw new Error(`create calendar ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).id as string;
}

export type CalendarEventInput = {
  summary: string;
  description?: string;
  start: string; // ISO
  end: string; // ISO
};

/** Založí či přepíše událost; vrací id události. Ztracenou (smazanou)
    událost zakládá znovu. */
export async function upsertEvent(
  userEmail: string,
  calendarId: string,
  eventId: string | null,
  ev: CalendarEventInput
): Promise<string> {
  const body = JSON.stringify({
    summary: ev.summary,
    description: ev.description ?? "",
    start: { dateTime: ev.start, timeZone: TZ },
    end: { dateTime: ev.end, timeZone: TZ },
  });
  if (eventId) {
    const res = await gfetch(
      userEmail,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "PUT", body }
    );
    if (res.ok) return eventId;
    if (res.status !== 404 && res.status !== 410) {
      throw new Error(`update event ${res.status}: ${await res.text()}`);
    }
    // událost mezitím zmizela → založit znovu
  }
  const res = await gfetch(
    userEmail,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body }
  );
  if (!res.ok) {
    throw new Error(`insert event ${res.status}: ${await res.text()}`);
  }
  return (await res.json()).id as string;
}

/** Smaže událost; už smazanou tiše přejde. */
export async function deleteEvent(
  userEmail: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await gfetch(
    userEmail,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`delete event ${res.status}: ${await res.text()}`);
  }
}
