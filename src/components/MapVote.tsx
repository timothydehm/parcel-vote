"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapData } from "@/lib/types";

// Fit the map to the parcels once, on first load. (Re-fitting on every vote
// would yank the viewport around.)
function FitBounds({ parcels }: { parcels: unknown }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    try {
      const b = L.geoJSON(parcels as GeoJSON.GeoJsonObject).getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [24, 24] });
        done.current = true;
      }
    } catch {
      /* ignore invalid geometry */
    }
  }, [parcels, map]);
  return null;
}

// Fill opacity encodes the share of participants who chose a parcel: 0 -> faint,
// 100% -> strong. A fixed scale, so a parcel never appears to fade as it gains
// votes.
function shareToOpacity(share: number) {
  if (share <= 0) return 0.05;
  return 0.15 + 0.7 * Math.min(1, share);
}

export default function MapVote({ id }: { id: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const inFlight = useRef<Set<string>>(new Set());

  async function load() {
    try {
      const r = await fetch(`/api/maps/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) return setError(d.error || "Could not load map.");
      setData(d);
      setVersion((v) => v + 1);
    } catch {
      setError("Could not reach the server.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function vote(pid: string) {
    if (!data || !data.is_open || inFlight.current.has(pid)) return;
    inFlight.current.add(pid);
    try {
      const r = await fetch(`/api/maps/${id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parcel_id: pid }),
      });
      const d = await r.json();
      if (r.ok) {
        setData((prev) =>
          prev ? { ...prev, counts: d.counts, totalVoters: d.totalVoters, yourVotes: d.yourVotes } : prev,
        );
        setVersion((v) => v + 1);
      }
    } finally {
      inFlight.current.delete(pid);
    }
  }

  const styleFn = useMemo(
    () =>
      (feature?: GeoJSON.Feature) => {
        const pid = String(feature?.properties?.__pid ?? "");
        const total = data?.totalVoters ?? 0;
        const votes = data?.counts?.[pid] ?? 0;
        const share = total ? votes / total : 0;
        const mine = data?.yourVotes?.includes(pid) ?? false;
        return {
          color: mine ? "#1d4ed8" : "#64748b",
          weight: mine ? 2.5 : 1,
          fillColor: "#2563eb",
          fillOpacity: shareToOpacity(share),
        };
      },
    [data],
  );

  function onEach(feature: GeoJSON.Feature, layer: L.Layer) {
    const pid = String(feature?.properties?.__pid ?? "");
    layer.on("click", () => vote(pid));
    const votes = data?.counts?.[pid] ?? 0;
    layer.bindTooltip(`${votes} vote${votes === 1 ? "" : "s"}`, { sticky: true });
  }

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading map…</div>;

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">{data.question}</h1>
        <p className="text-sm text-slate-500">
          {data.is_open ? "Click parcels to cast or remove your vote." : "This map is closed to new votes."} ·{" "}
          {data.totalVoters} {data.totalVoters === 1 ? "person has" : "people have"} voted
        </p>
      </header>
      <div className="relative flex-1">
        <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" preferCanvas>
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds parcels={data.parcels} />
          <GeoJSON
            key={version}
            data={data.parcels as unknown as GeoJSON.GeoJsonObject}
            style={styleFn}
            onEachFeature={onEach}
          />
        </MapContainer>
      </div>
    </div>
  );
}
