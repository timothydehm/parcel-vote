import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./supabase";

export const SESSION_COOKIE = "pp_session";

// Password hashing with Node's built-in scrypt (no external dependency).
// Stored as "salt:hash". Passwords are optional; only set when a participant
// chooses to protect their name.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(pw, salt, 64);
  const orig = Buffer.from(hash, "hex");
  return test.length === orig.length && timingSafeEqual(test, orig);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

// Canonical form of a name for uniqueness: trimmed + lowercased.
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

export type Participant = { id: string; name: string };

// Resolve the current session cookie to a participant on THIS map, or null.
export async function getParticipant(req: NextRequest, mapId: string): Promise<Participant | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { data: sess } = await db
    .from("sessions")
    .select("participant_id, map_id")
    .eq("token", token)
    .maybeSingle();
  if (!sess || sess.map_id !== mapId) return null;

  const { data: p } = await db
    .from("participants")
    .select("id, name")
    .eq("id", sess.participant_id)
    .maybeSingle();
  return p ? { id: p.id, name: p.name } : null;
}
