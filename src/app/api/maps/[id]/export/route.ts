import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { tallyMap } from "@/lib/votes";
import type { ParcelFeature } from "@/lib/types";

export const runtime = "nodejs";

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Defuse spreadsheet formula injection: a cell beginning with one of these
  // can run as a formula when the CSV is opened in Excel / Google Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvResponse(name: string, rows: string[]) {
  return new NextResponse(rows.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}

// GET /api/maps/:id/export?token=ADMIN&format=geojson|csv|comments|voters
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const format = (url.searchParams.get("format") ?? "geojson").toLowerCase();

  const { data: map } = await db
    .from("maps")
    .select("id, question, parcels, admin_token")
    .eq("id", params.id)
    .single();
  if (!map) return NextResponse.json({ error: "Map not found." }, { status: 404 });
  if (!token || token !== map.admin_token) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  if (format === "comments") {
    const { data } = await db
      .from("comments")
      .select("parcel_id, author_name, body, created_at")
      .eq("map_id", map.id)
      .order("created_at", { ascending: true });
    const rows = ["parcel_id,author,comment,created_at"];
    for (const c of data ?? []) {
      rows.push(
        [csvCell(c.parcel_id), csvCell(c.author_name ?? ""), csvCell(c.body), csvCell(c.created_at)].join(","),
      );
    }
    return csvResponse(`parcel-pulse-notes-${map.id}.csv`, rows);
  }

  if (format === "voters") {
    const { data: votes } = await db.from("votes").select("parcel_id, voter_id").eq("map_id", map.id);
    const { data: parts } = await db.from("participants").select("id, name").eq("map_id", map.id);
    const nameById = new Map<string, string>((parts ?? []).map((p) => [p.id, p.name]));
    const rows = ["parcel_id,voter_name"];
    for (const v of votes ?? []) {
      rows.push([csvCell(v.parcel_id), csvCell(nameById.get(v.voter_id) ?? "(anonymous)")].join(","));
    }
    return csvResponse(`parcel-pulse-voters-${map.id}.csv`, rows);
  }

  const { counts, totalVoters } = await tallyMap(map.id, null);
  const features = (map.parcels as { features: ParcelFeature[] }).features;

  if (format === "csv") {
    const rows = ["parcel_id,votes,share,total_voters"];
    for (const f of features) {
      const pid = f.properties.__pid;
      const v = counts[pid] ?? 0;
      const share = totalVoters ? (v / totalVoters).toFixed(4) : "0";
      rows.push([csvCell(pid), String(v), share, String(totalVoters)].join(","));
    }
    return csvResponse(`parcel-pulse-${map.id}.csv`, rows);
  }

  const out = {
    type: "FeatureCollection",
    features: features.map((f) => {
      const pid = f.properties.__pid;
      const v = counts[pid] ?? 0;
      return {
        ...f,
        properties: { ...f.properties, votes: v, share: totalVoters ? v / totalVoters : 0 },
      };
    }),
  };
  return new NextResponse(JSON.stringify(out), {
    headers: {
      "content-type": "application/geo+json",
      "content-disposition": `attachment; filename="parcel-pulse-${map.id}.geojson"`,
    },
  });
}
