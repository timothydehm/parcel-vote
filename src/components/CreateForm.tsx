"use client";

import { useState } from "react";

type CreateResult = { id: string; admin_token: string };

// Vercel rejects request bodies larger than ~4.5 MB before our code even runs,
// so we trim and size-check the GeoJSON on the client.
const MAX_BYTES = 4_300_000;

// Round every coordinate to 6 decimals (~0.1 m) — invisible at parcel scale but
// a big size reduction, since raw exports often carry 13+ decimals.
function roundCoords(x: unknown): unknown {
  if (typeof x === "number") return Math.round(x * 1e6) / 1e6;
  if (Array.isArray(x)) return x.map(roundCoords);
  return x;
}

function shrink(geo: any) {
  if (geo && Array.isArray(geo.features)) {
    for (const f of geo.features) {
      if (f && f.geometry && f.geometry.coordinates) {
        f.geometry.coordinates = roundCoords(f.geometry.coordinates);
      }
    }
  }
  return geo;
}

export default function CreateForm() {
  const [question, setQuestion] = useState("");
  const [voteLimit, setVoteLimit] = useState("");
  const [fileName, setFileName] = useState("");
  const [parcels, setParcels] = useState<unknown>(null);
  const [sizeNote, setSizeNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    setSizeNote("");
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    try {
      const geo = shrink(JSON.parse(await f.text()));
      setParcels(geo);
      const mb = JSON.stringify(geo).length / 1e6;
      setSizeNote(`${mb.toFixed(1)} MB after optimizing`);
      if (JSON.stringify(geo).length > MAX_BYTES) {
        setError(
          `This file is ~${mb.toFixed(1)} MB, over the ~4.5 MB upload limit even after trimming. ` +
            "Try a smaller area, or simplify the parcels first (mapshaper.org is a quick, free way to do it).",
        );
      }
    } catch {
      setParcels(null);
      setError("That file is not valid JSON / GeoJSON.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!question.trim()) return setError("Enter a question.");
    if (!parcels) return setError("Upload a GeoJSON parcels file.");

    const body = JSON.stringify({
      question,
      parcels,
      vote_limit: voteLimit.trim() === "" ? null : Number(voteLimit),
    });
    if (body.length > MAX_BYTES) {
      return setError(
        `This file is ~${(body.length / 1e6).toFixed(1)} MB, over the ~4.5 MB upload limit. ` +
          "Try a smaller area, or simplify the parcels first (mapshaper.org).",
      );
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
      } catch {
        /* non-JSON response (e.g. a 413 plain-text error) */
      }
      if (!r.ok) {
        if (r.status === 413) {
          throw new Error("That file is too large to upload (server limit is about 4.5 MB). Try a smaller area or simpler parcels.");
        }
        throw new Error(data.error || `Failed to create map (error ${r.status}).`);
      }
      setResult(data as CreateResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const voteUrl = `${base}/m/${result.id}`;
    const adminUrl = `${base}/m/${result.id}/admin?token=${result.admin_token}`;
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Your map is live</h2>
          <p className="text-sm text-slate-500">Save the admin link now — it is the only way back to your results.</p>
        </div>
        <LinkRow label="Public — share this to collect votes" url={voteUrl} />
        <LinkRow label="Private — your results & export" url={adminUrl} />
        <a className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white" href={voteUrl}>
          Open the voting map
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium">Question</label>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Where should we plant trees?"
          maxLength={280}
          className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Parcels (GeoJSON)</label>
        <input
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          onChange={onFile}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
        />
        {fileName && (
          <p className="mt-1 text-xs text-slate-500">
            {fileName}
            {sizeNote ? ` · ${sizeNote}` : ""}
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Votes per person</label>
        <input
          type="number"
          min={1}
          value={voteLimit}
          onChange={(e) => setVoteLimit(e.target.value)}
          placeholder="Leave blank for unlimited"
          className="w-full rounded border border-slate-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Cap how many parcels each person can choose, to force prioritization. Blank = unlimited.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create map"}
      </button>
    </form>
  );
}

function LinkRow({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 flex gap-2">
        <input readOnly value={url} className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-600" />
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
