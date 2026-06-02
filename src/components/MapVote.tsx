"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Comment, MapData } from "@/lib/types";

type Mode = "vote" | "notes";

// Fit the map to the parcels once, on first load.
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

// Fill opacity encodes the share of participants who chose a parcel.
function shareToOpacity(share: number) {
  if (share <= 0) return 0.05;
  return 0.15 + 0.7 * Math.min(1, share);
}

export default function MapVote({ id }: { id: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [mode, setMode] = useState<Mode>("vote");
  const [selected, setSelected] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const voting = useRef(false);
  // Click handlers are bound once per parcel layer; this ref lets them read the
  // current mode without rebinding every time the mode changes.
  const modeRef = useRef<Mode>("vote");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

  function switchMode(m: Mode) {
    setMode(m);
    setSelected(null);
    setVersion((v) => v + 1);
  }

  async function openParcel(pid: string) {
    setSelected(pid);
    setVersion((v) => v + 1);
    setComments(null);
    setDraft("");
    try {
      const r = await fetch(`/api/maps/${id}/comments?parcel_id=${encodeURIComponent(pid)}`, {
        cache: "no-store",
      });
      const d = await r.json();
      setComments(r.ok ? d.comments : []);
    } catch {
      setComments([]);
    }
  }

  async function toggleVote(pid: string) {
    if (!data || !data.is_open || voting.current) return;
    voting.current = true;
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
      voting.current = false;
    }
  }

  async function addComment() {
    if (!data || !selected || !draft.trim() || busy) return;
    setBusy(true);
    const pid = selected;
    try {
      const r = await fetch(`/api/maps/${id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parcel_id: pid, body: draft.trim() }),
      });
      const d = await r.json();
      if (r.ok) {
        const list = d.comments as Comment[];
        setComments(list);
        setDraft("");
        setData((prev) =>
          prev ? { ...prev, commentCounts: { ...prev.commentCounts, [pid]: list.length } } : prev,
        );
        setVersion((v) => v + 1);
      } else {
        setError(d.error || "Could not add note.");
      }
    } finally {
      setBusy(false);
    }
  }

  const styleFn = useMemo(
    () =>
      (feature?: GeoJSON.Feature) => {
        const pid = String(feature?.properties?.__pid ?? "");
        const total = data?.totalVoters ?? 0;
        const votes = data?.counts?.[pid] ?? 0;
        const share = total ? votes / total : 0;
        const hasComments = (data?.commentCounts?.[pid] ?? 0) > 0;
        const mine = data?.yourVotes?.includes(pid) ?? false;
        const isSel = pid === selected;

        let color = "#64748b";
        let weight = 1;
        if (isSel) {
          color = "#1d4ed8";
          weight = 3;
        } else if (hasComments) {
          color = "#d97706";
          weight = 2;
        } else if (mine) {
          color = "#2563eb";
          weight = 2;
        }
        return { color, weight, fillColor: "#2563eb", fillOpacity: shareToOpacity(share) };
      },
    [data, selected],
  );

  function onEach(feature: GeoJSON.Feature, layer: L.Layer) {
    const pid = String(feature?.properties?.__pid ?? "");
    layer.on("click", () => {
      if (modeRef.current === "vote") toggleVote(pid);
      else openParcel(pid);
    });
    const votes = data?.counts?.[pid] ?? 0;
    const notes = data?.commentCounts?.[pid] ?? 0;
    const noteTxt = notes > 0 ? ` · ${notes} note${notes === 1 ? "" : "s"}` : "";
    layer.bindTooltip(`${votes} vote${votes === 1 ? "" : "s"}${noteTxt}`, { sticky: true });
  }

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading map…</div>;

  const selVotes = selected ? data.counts[selected] ?? 0 : 0;
  const selShare = data.totalVoters ? Math.round((selVotes / data.totalVoters) * 100) : 0;
  const selMine = selected ? data.yourVotes.includes(selected) : false;

  const segActive = "rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white";
  const segIdle = "rounded-md px-3 py-1 text-sm font-medium text-slate-600";

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold">{data.question}</h1>
        <p className="text-sm text-slate-500">
          {!data.is_open
            ? "This map is closed."
            : mode === "vote"
              ? "Vote mode — click a parcel to cast or remove your vote."
              : "Notes mode — click a parcel to read or add notes."}{" "}
          {"·"} {data.totalVoters} {data.totalVoters === 1 ? "person has" : "people have"} voted
        </p>
      </header>

      <div className="relative flex-1">
        <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" preferCanvas>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
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

        <div className="absolute left-3 top-3 z-[1200] flex rounded-lg border border-slate-200 bg-white p-0.5 shadow">
          <button onClick={() => switchMode("vote")} className={mode === "vote" ? segActive : segIdle}>
            Vote
          </button>
          <button onClick={() => switchMode("notes")} className={mode === "notes" ? segActive : segIdle}>
            Notes
          </button>
        </div>

        {mode === "notes" && selected && (
          <div className="absolute right-3 top-3 z-[1200] flex max-h-[calc(100%-1.5rem)] w-80 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="flex items-start justify-between border-b border-slate-100 p-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Parcel</div>
                <div className="font-mono text-sm font-medium">{selected}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {selVotes} {selVotes === 1 ? "vote" : "votes"} {"·"} {selShare}%
                  {selMine ? " · you voted here" : ""}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                {"✕"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Notes</div>
              {comments === null && <div className="text-sm text-slate-400">Loading…</div>}
              {comments !== null && comments.length === 0 && (
                <div className="text-sm text-slate-400">No notes yet.</div>
              )}
              {comments !== null &&
                comments.map((c) => (
                  <div key={c.id} className="mb-2 rounded bg-slate-50 p-2 text-sm">
                    <div className="whitespace-pre-wrap break-words">{c.body}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {new Date(c.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
            </div>

            {data.is_open && (
              <div className="border-t border-slate-100 p-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Add a note about this parcel…"
                  maxLength={500}
                  rows={2}
                  className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                />
                <button
                  onClick={addComment}
                  disabled={busy || !draft.trim()}
                  className="mt-2 w-full rounded bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Adding…" : "Add note"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
