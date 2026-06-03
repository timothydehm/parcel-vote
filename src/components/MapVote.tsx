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
  const [noteError, setNoteError] = useState("");
  const [voteNote, setVoteNote] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const voting = useRef(false);
  const modeRef = useRef<Mode>("vote");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Auto-dismiss the transient vote message.
  useEffect(() => {
    if (!voteNote) return;
    const t = setTimeout(() => setVoteNote(""), 3500);
    return () => clearTimeout(t);
  }, [voteNote]);

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

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!joinName.trim() || joinBusy) return;
    setJoinBusy(true);
    setJoinError("");
    try {
      const r = await fetch(`/api/maps/${id}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: joinName.trim(), password: joinPassword }),
      });
      let d: { error?: string } = {};
      try {
        d = await r.json();
      } catch {
        /* non-JSON */
      }
      if (r.ok) {
        setJoinPassword("");
        await load();
      } else {
        setJoinError(d.error || "Could not join.");
      }
    } catch {
      setJoinError("Could not reach the server.");
    } finally {
      setJoinBusy(false);
    }
  }

  async function switchName() {
    await fetch(`/api/maps/${id}/logout`, { method: "POST" });
    setSelected(null);
    await load();
  }

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
    setNoteError("");
    try {
      const r = await fetch(`/api/maps/${id}/comments?parcel_id=${encodeURIComponent(pid)}`, {
        cache: "no-store",
      });
      let d: { comments?: Comment[] } = {};
      try {
        d = await r.json();
      } catch {
        /* non-JSON response */
      }
      setComments(r.ok ? d.comments ?? [] : []);
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
      if (r.status === 401) {
        await load();
        return;
      }
      let d: { counts?: Record<string, number>; totalVoters?: number; yourVotes?: string[]; error?: string } = {};
      try {
        d = await r.json();
      } catch {
        /* non-JSON */
      }
      if (r.ok) {
        setData((prev) =>
          prev
            ? { ...prev, counts: d.counts ?? {}, totalVoters: d.totalVoters ?? 0, yourVotes: d.yourVotes ?? [] }
            : prev,
        );
        setVersion((v) => v + 1);
        setVoteNote("");
      } else {
        setVoteNote(d.error || "Could not vote.");
      }
    } catch {
      /* a failed vote is silently ignored; the map state is unchanged */
    } finally {
      voting.current = false;
    }
  }

  async function addComment() {
    if (!data || !selected || !draft.trim() || busy) return;
    setBusy(true);
    setNoteError("");
    const pid = selected;
    try {
      const r = await fetch(`/api/maps/${id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parcel_id: pid, body: draft.trim() }),
      });
      if (r.status === 401) {
        await load();
        return;
      }
      let d: { comments?: Comment[]; error?: string } = {};
      try {
        d = await r.json();
      } catch {
        /* non-JSON response */
      }
      if (r.ok) {
        const list = d.comments ?? [];
        setComments(list);
        setDraft("");
        setData((prev) =>
          prev ? { ...prev, commentCounts: { ...prev.commentCounts, [pid]: list.length } } : prev,
        );
        setVersion((v) => v + 1);
      } else {
        setNoteError(d.error || `Could not save note (error ${r.status}).`);
      }
    } catch {
      setNoteError("Could not reach the server. Please try again.");
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

  // Name gate: require a name before showing the map.
  if (!data.me) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{data.question}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Enter a name to take part. Add a password to protect it (optional) so only you can use it.
            {data.vote_limit ? ` You get ${data.vote_limit} votes.` : ""}
          </p>
          <form onSubmit={join} className="mt-4 space-y-3">
            <input
              id="join-name"
              name="name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Your name"
              maxLength={40}
              autoFocus
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              id="join-password"
              name="password"
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="Password (optional)"
              maxLength={100}
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            {joinError && <p className="text-sm text-red-600">{joinError}</p>}
            <button
              type="submit"
              disabled={joinBusy || !joinName.trim()}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {joinBusy ? "Joining…" : "Join"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const selVotes = selected ? data.counts[selected] ?? 0 : 0;
  const selShare = data.totalVoters ? Math.round((selVotes / data.totalVoters) * 100) : 0;
  const selMine = selected ? data.yourVotes.includes(selected) : false;
  const remaining = data.vote_limit ? Math.max(0, data.vote_limit - data.yourVotes.length) : null;

  const segActive = "rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white";
  const segIdle = "rounded-md px-3 py-1 text-sm font-medium text-slate-600";

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{data.question}</h1>
          <p className="truncate text-sm text-slate-500">
            {!data.is_open
              ? "This map is closed."
              : mode === "vote"
                ? "Vote mode — click a parcel to cast or remove your vote."
                : "Notes mode — click a parcel to read or add notes."}{" "}
            {"·"} {data.totalVoters} {data.totalVoters === 1 ? "person has" : "people have"} voted
            {remaining !== null ? (
              <span className="font-medium text-slate-700">
                {" · "}
                {remaining} of {data.vote_limit} votes left
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-slate-400">
            You&rsquo;re <span className="font-medium text-slate-600">{data.me}</span>{" "}
            {"·"}{" "}
            <button onClick={switchName} className="underline hover:text-slate-700">
              switch name
            </button>
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-slate-200 p-0.5">
          <button onClick={() => switchMode("vote")} className={mode === "vote" ? segActive : segIdle}>
            Vote
          </button>
          <button onClick={() => switchMode("notes")} className={mode === "notes" ? segActive : segIdle}>
            Notes
          </button>
        </div>
      </header>

      <div className="relative flex-1">
        <MapContainer center={[0, 0]} zoom={2} maxZoom={22} className="h-full w-full" preferCanvas>
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={22}
            maxNativeZoom={19}
          />
          <FitBounds parcels={data.parcels} />
          <GeoJSON
            key={version}
            data={data.parcels as unknown as GeoJSON.GeoJsonObject}
            style={styleFn}
            onEachFeature={onEach}
          />
        </MapContainer>

        {voteNote && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-[1200] max-w-[90%] -translate-x-1/2 rounded-md bg-slate-900 px-4 py-2 text-center text-sm text-white shadow-lg">
            {voteNote}
          </div>
        )}

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
                      {c.author_name ? (
                        <span className="font-medium text-slate-500">{c.author_name}</span>
                      ) : null}
                      {c.author_name ? " · " : ""}
                      {new Date(c.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
            </div>

            {data.is_open && (
              <div className="border-t border-slate-100 p-3">
                <textarea
                  id="note-input"
                  name="note"
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
                {noteError && <p className="mt-2 text-sm text-red-600">{noteError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
