"use client";

import { useEffect, useState } from "react";
import type { MapData } from "@/lib/types";

export default function AdminView({ id, token }: { id: string; token: string }) {
  const [data, setData] = useState<MapData | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await fetch(`/api/maps/${id}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) return setError(d.error || "Could not load.");
      setData(d);
    } catch {
      setError("Could not reach the server.");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function setOpen(is_open: boolean) {
    await fetch(`/api/maps/${id}/close?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ is_open }),
    });
    load();
  }

  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading…</div>;

  const rows = data.parcels.features
    .map((f) => {
      const pid = f.properties.__pid;
      const votes = data.counts[pid] ?? 0;
      const notes = data.commentCounts?.[pid] ?? 0;
      return { pid, votes, notes, share: data.totalVoters ? votes / data.totalVoters : 0 };
    })
    .sort((a, b) => b.votes - a.votes || b.notes - a.notes);

  const exportUrl = (format: string) =>
    `/api/maps/${id}/export?format=${format}&token=${encodeURIComponent(token)}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-xl font-bold">{data.question}</h1>
      <p className="mt-1 text-slate-600">
        {data.totalVoters} total {data.totalVoters === 1 ? "voter" : "voters"} {"·"}{" "}
        <span className={data.is_open ? "text-green-600" : "text-red-600"}>
          {data.is_open ? "open" : "closed"}
        </span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={exportUrl("geojson")} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">
          Export GeoJSON
        </a>
        <a href={exportUrl("csv")} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">
          Export votes (CSV)
        </a>
        <a href={exportUrl("comments")} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white">
          Export notes (CSV)
        </a>
        <a href={`/m/${id}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
          Open voting map
        </a>
        {data.is_open ? (
          <button onClick={() => setOpen(false)} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white">
            Close map
          </button>
        ) : (
          <button onClick={() => setOpen(true)} className="rounded bg-green-600 px-3 py-1.5 text-sm text-white">
            Reopen map
          </button>
        )}
      </div>

      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left text-slate-500">
            <th className="py-2 font-medium">Parcel</th>
            <th className="py-2 font-medium">Votes</th>
            <th className="py-2 font-medium">Share</th>
            <th className="py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pid} className="border-b border-slate-100">
              <td className="py-1.5 font-mono text-xs">{r.pid}</td>
              <td className="py-1.5">{r.votes}</td>
              <td className="py-1.5">{(r.share * 100).toFixed(0)}%</td>
              <td className="py-1.5">{r.notes || ""}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-slate-400">
                No parcels.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
