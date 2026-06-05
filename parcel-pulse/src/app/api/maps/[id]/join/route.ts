import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { hashPassword, verifyPassword, newSessionToken, nameKey, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/maps/:id/join  — { name, password? }
// Creates or authenticates a per-map participant and starts a session.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { name?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body?.name ?? "").trim();
  const password = String(body?.password ?? "");
  if (!name) return NextResponse.json({ error: "Please enter a name." }, { status: 400 });
  if (name.length > 40) return NextResponse.json({ error: "Name is too long (40 max)." }, { status: 400 });
  if (password.length > 100) return NextResponse.json({ error: "Password is too long." }, { status: 400 });

  const { data: map } = await db.from("maps").select("id").eq("id", params.id).single();
  if (!map) return NextResponse.json({ error: "Map not found." }, { status: 404 });

  const key = nameKey(name);
  const { data: existing } = await db
    .from("participants")
    .select("id, name, password_hash")
    .eq("map_id", map.id)
    .eq("name_key", key)
    .maybeSingle();

  let participantId: string;
  let displayName: string;

  if (existing) {
    if (existing.password_hash) {
      if (!password) {
        return NextResponse.json(
          { error: "That name is protected. Enter its password to continue.", needsPassword: true },
          { status: 401 },
        );
      }
      if (!verifyPassword(password, existing.password_hash)) {
        return NextResponse.json(
          { error: "Incorrect password for that name.", needsPassword: true },
          { status: 401 },
        );
      }
    }
    // Unprotected name: anyone may use it (when2meet behavior).
    participantId = existing.id;
    displayName = existing.name;
  } else {
    const insert: Record<string, unknown> = { map_id: map.id, name, name_key: key };
    if (password) insert.password_hash = hashPassword(password);
    const { data: created, error } = await db
      .from("participants")
      .insert(insert)
      .select("id, name")
      .single();
    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? "Could not create that name." }, { status: 500 });
    }
    participantId = created.id;
    displayName = created.name;
  }

  const token = newSessionToken();
  const { error: sErr } = await db
    .from("sessions")
    .insert({ token, participant_id: participantId, map_id: map.id });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const res = NextResponse.json({ name: displayName });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
