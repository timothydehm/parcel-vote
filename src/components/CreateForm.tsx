"use client";

import { useState } from "react";
import ParcelPicker from "./ParcelPicker";
import { dash } from "@/lib/ppn";
import type { SelectedParcel } from "@/lib/types";

type Result = { id: string; admin_token: string };

export default function CreateForm() {
  const [question, setQuestion] = useState("");
  const [voteLimit, setVoteLimit] = useState("");
  const [selected, setSelected] = useState<SelectedParcel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function create() {
    setError("");
    if (!question.trim()) return setError("Add a question first.");
    if (selected.length === 0) return setError("Pick at least one parcel on the map.");

    const parcels = {
      type: "FeatureCollection",
      features: selected.map((s) => ({
        type: "Feature",
        geometry: s.geometry,
        // Store the PPN (dashed) as the stable id, plus owner, address, type, neighborhood, ward.
        properties: { ...(s.props ?? {}), __pid: dash(s.pid), owner: s.owner },
      })),
    };

    const body = JSON.stringify({ question, parcels, vote_limit: voteLimit.trim() === "" ? null : Number(voteLimit) });
    // Vercel rejects request bodies over ~4.5 MB before our code runs.
    if (body.length > 4_300_000) {
      return setError(`That's too many parcels to save in one map (~${(body.length / 1e6).toFixed(1)} MB). Pick a smaller area.`);
    }

    setBusy(true);
    try {
      const r = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      let data: { id?: string; admin_token?: string; error?: string } = {};
      try {
        data = await r.json();
      } catch {}
      if (!r.ok) throw new Error(data.error || `Couldn't create the map (error ${r.status}).`);
      setResult(data as Result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="mr-1 text-base font-bold tracking-tight text-slate-900">Parcel Pulse</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={280}
          placeholder="Your question — e.g. Which lots should become gardens?"
          className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Votes each
          <input
            type="number"
            min={1}
            value={voteLimit}
            onChange={(e) => setVoteLimit(e.target.value)}
            placeholder="∞"
            className="w-20 rounded-md border border-slate-300 px-2 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          onClick={create}
          disabled={busy || !question.trim() || selected.length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {busy ? "Creating…" : `Create map${selected.length ? ` · ${selected.length}` : ""}`}
        </button>
        {error && <span className="w-full text-sm text-red-600 md:w-auto">{error}</span>}
      </header>

      <div className="min-h-0 flex-1">
        <ParcelPicker onSelectionChange={setSelected} />
      </div>

      {result && <ResultCard result={result} />}
    </div>
  );
}

function ResultCard({ result }: { result: Result }) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const voteUrl = `${base}/m/${result.id}`;
  const adminUrl = `${base}/m/${result.id}/admin?token=${result.admin_token}`;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg space-y-5 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h2 className="text-lg font-bold">Your voting map is live</h2>
          <p className="text-sm text-slate-500">Save the private link now — it&rsquo;s the only way back to your results.</p>
        </div>
        <LinkRow label="Public — share this to collect votes" url={voteUrl} />
        <LinkRow label="Private — your results & exports" url={adminUrl} />
        <div className="flex gap-2">
          <a href={voteUrl} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white">
            Open the voting map
          </a>
          <button onClick={() => window.location.reload()} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold">
            Make another
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 flex gap-2">
        <input readOnly value={url} className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-600" />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded-md bg-slate-800 px-3 py-1 text-sm text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
