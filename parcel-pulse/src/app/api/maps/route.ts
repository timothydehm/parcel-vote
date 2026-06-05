import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { normalizeParcels } from "@/lib/geojson";

export const runtime = "nodejs";

// Parse an optional "votes per person" value. Blank/absent -> null (unlimited).
function parseVoteLimit(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return "invalid";
  return Math.min(1000, Math.floor(n));
}

// POST /api/maps  — create a map. Body: { question, parcels, vote_limit? }
export async function POST(req: NextRequest) {
  let body: { question?: unknown; parcels?: unknown; vote_limit?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = String(body?.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "A question is required." }, { status: 400 });
  if (question.length > 280) {
    return NextResponse.json({ error: "Question is too long (280 max)." }, { status: 400 });
  }

  const vote_limit = parseVoteLimit(body?.vote_limit);
  if (vote_limit === "invalid") {
    return NextResponse.json({ error: "Votes per person must be a whole number of 1 or more." }, { status: 400 });
  }

  let parcels;
  try {
    parcels = normalizeParcels(body?.parcels);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (parcels.features.length > 20000) {
    return NextResponse.json({ error: "Too many parcels (20000 max)." }, { status: 400 });
  }

  const admin_token = randomUUID();
  const { data, error } = await db
    .from("maps")
    .insert({ question, parcels, admin_token, is_open: true, vote_limit })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Could not create map." }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, admin_token });
}
