"use client";

// Leaflet's own stylesheet — without it tiles land in the wrong place and shapes don't draw.
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { pinKey, dash } from "@/lib/ppn";
import {
  LANDBANK_LAYER,
  NEIGHBORHOOD_LAYER,
  WARD_LAYER,
  LANDBANK_OWNER,
  LOAD_CAP,
  NEIGHBORHOODS,
  WARDS,
  neighborhoodWhere,
  wardWhere,
  bboxCenter,
  pointInGeometry,
  toEsriPolygon,
} from "@/lib/county";
import type { SelectedParcel } from "@/lib/types";

const LABEL_ZOOM = 18;
const CLEVELAND: [number, number] = [41.48, -81.68];
const OUT_FIELDS = "parcelpin,par_addr_all,cityLandBankType,total_square_ft";

type Props = { onSelectionChange: (parcels: SelectedParcel[]) => void };
type Status = { kind: "" | "loading" | "ok" | "err"; text: string };
type Hover = { pid: string; addr: string; type: string } | null;

// City of Cleveland Land Bank parcels, narrowed by neighborhood and/or ward. Pick an
// area, show its land bank parcels, then select all or click to fine-tune.
export default function ParcelPicker({ onSelectionChange }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<Ctrl | null>(null);
  const onSel = useRef(onSelectionChange);
  useEffect(() => {
    onSel.current = onSelectionChange;
  });

  const [hood, setHood] = useState("");
  const [ward, setWard] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "", text: "" });
  const [shown, setShown] = useState(0);
  const [sel, setSel] = useState<{ pid: string; addr: string }[]>([]);
  const [labelMode, setLabelModeState] = useState<"pin" | "addr">("pin");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<Hover>(null);
  const [note, setNote] = useState("Pick a neighborhood or ward, then Show parcels");

  useEffect(() => {
    let disposed = false;
    let map: any;

    (async () => {
      const L = ((await import("leaflet")).default ?? (await import("leaflet"))) as any;
      if (disposed || !mapEl.current) return;

      const S = {
        streets: false,
        labelMode: "pin" as "pin" | "addr",
        byPin: new Map<string, any>(),
        info: new Map<string, { geometry: any; props: Record<string, unknown> }>(),
        selected: new Set<string>(),
        lastShown: [] as string[],
      };

      map = L.map(mapEl.current, { boxZoom: false, preferCanvas: true, zoomControl: true }).setView(CLEVELAND, 12);
      const esriAttr = "Imagery & streets &copy; Esri";
      const aerial = L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: esriAttr }),
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, pane: "overlayPane", opacity: 0.9 }),
      ]);
      const streets = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: esriAttr });
      aerial.addTo(map);
      L.control.layers({ Aerial: aerial, Streets: streets }, null, { position: "topright" }).addTo(map);
      map.attributionControl.addAttribution("Parcels: City of Cleveland Land Bank");
      map.on("baselayerchange", (e: any) => {
        S.streets = e.layer === streets;
        mapEl.current?.classList.toggle("streets", S.streets);
        boundary.setStyle(boundaryStyle());
        restyleAll();
      });

      const boundaryStyle = () => ({ color: S.streets ? "#0f172a" : "#ffffff", weight: 3, dashArray: "8 6", fill: false, interactive: false });
      const boundary = L.geoJSON(null, { style: boundaryStyle, interactive: false }).addTo(map);

      function styleFor(pin: string) {
        if (S.selected.has(pin)) return { color: "#1d4ed8", weight: 2, opacity: 1, fillColor: "#2563eb", fillOpacity: 0.5 };
        return { color: "#f59e0b", weight: 1.5, opacity: 1, fillColor: "#fbbf24", fillOpacity: 0.22 };
      }
      const restyle = (pin: string) => S.byPin.get(pin)?.setStyle(styleFor(pin));
      const restyleAll = () => {
        S.byPin.forEach((l, pin) => l.setStyle(styleFor(pin)));
        refreshLabels();
      };

      const parcels = L.geoJSON(null, {
        style: (f: any) => styleFor(f.properties.__pin),
        onEachFeature: (f: any, layer: any) => {
          const pin = f.properties.__pin;
          S.byPin.set(pin, layer);
          layer.on("click", () => toggle(pin));
          layer.on("mouseover", () => {
            const p = S.info.get(pin)?.props ?? {};
            setHover({ pid: pin, addr: String(p.par_addr_all ?? ""), type: String(p.cityLandBankType ?? "") });
            if (!S.selected.has(pin)) layer.setStyle({ weight: 3, color: S.streets ? "#0f172a" : "#ffffff" });
          });
          layer.on("mouseout", () => layer.setStyle(styleFor(pin)));
        },
      }).addTo(map);

      const labels = L.layerGroup().addTo(map);
      function refreshLabels() {
        labels.clearLayers();
        if (map.getZoom() < LABEL_ZOOM) return;
        const view = map.getBounds();
        let n = 0;
        for (const [pin, layer] of S.byPin) {
          const c = layer.getBounds().getCenter();
          if (!view.contains(c)) continue;
          const byAddr = S.labelMode === "addr";
          const addr = String(S.info.get(pin)?.props.par_addr_all ?? "").split(",")[0];
          const text = byAddr ? addr || "—" : dash(pin);
          labels.addLayer(
            L.marker(c, {
              interactive: false,
              keyboard: false,
              icon: byAddr
                ? L.divIcon({ className: "pin-label owner", html: escapeHtml(text), iconSize: [120, 26], iconAnchor: [60, 13] })
                : L.divIcon({ className: "pin-label", html: escapeHtml(text), iconSize: [90, 14], iconAnchor: [45, 7] }),
            }),
          );
          if (++n > 400) break;
        }
      }
      map.on("moveend", refreshLabels);

      async function request(url: string, params: Record<string, string>, post = false) {
        const qs = new URLSearchParams(params);
        const res = post
          ? await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: qs })
          : await fetch(url + "?" + qs.toString());
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data && data.error) throw new Error(data.error.message || "Service error");
        return data;
      }

      // Fetch a boundary (neighborhood or ward) as a single GeoJSON geometry in lat/lng.
      async function fetchBoundary(layer: string, where: string) {
        const fc = await request(layer + "/query", {
          where,
          outFields: "*",
          outSR: "4326",
          geometryPrecision: "6",
          maxAllowableOffset: "0.00003",
          f: "geojson",
        });
        const geoms = (fc.features || []).map((f: any) => f.geometry).filter(Boolean);
        if (!geoms.length) throw new Error("Couldn't load that boundary.");
        if (geoms.length === 1) return geoms[0];
        return {
          type: "MultiPolygon",
          coordinates: geoms.flatMap((g: any) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates)),
        };
      }

      function addFeatures(features: any[], extra: Record<string, unknown>) {
        const added: string[] = [];
        for (const f of features) {
          const pin = pinKey(f.properties?.parcelpin);
          if (!pin || !f.geometry) continue;
          if (!S.byPin.has(pin)) {
            const p = f.properties || {};
            S.info.set(pin, {
              geometry: f.geometry,
              props: {
                par_addr_all: p.par_addr_all ?? null,
                cityLandBankType: p.cityLandBankType ?? null,
                total_square_ft: p.total_square_ft ?? null,
                ...extra,
              },
            });
            parcels.addData({ type: "Feature", geometry: f.geometry, properties: { __pin: pin } });
          }
          added.push(pin);
        }
        refreshLabels();
        return added;
      }

      function dropUnselected() {
        for (const [pin, layer] of [...S.byPin]) {
          if (S.selected.has(pin)) continue;
          parcels.removeLayer(layer);
          S.byPin.delete(pin);
          S.info.delete(pin);
        }
      }

      async function show(h: string, w: string) {
        if (!h && !w) {
          setStatus({ kind: "err", text: "Pick a neighborhood or a ward first — there are 16,000+ land bank parcels citywide." });
          return;
        }
        try {
          setStatus({ kind: "loading", text: "Loading boundary…" });
          const bounds: any[] = [];
          if (h) bounds.push(await fetchBoundary(NEIGHBORHOOD_LAYER, neighborhoodWhere(h)!));
          if (w) bounds.push(await fetchBoundary(WARD_LAYER, wardWhere(w)!));
          boundary.clearLayers();
          bounds.forEach((g) => boundary.addData({ type: "Feature", geometry: g, properties: {} }));

          const spatial = {
            where: "1=1",
            geometry: JSON.stringify(toEsriPolygon(bounds[0])),
            geometryType: "esriGeometryPolygon",
            inSR: "4326",
            spatialRel: "esriSpatialRelIntersects",
          };
          setStatus({ kind: "loading", text: "Counting land bank parcels…" });
          const c = await request(LANDBANK_LAYER + "/query", { ...spatial, returnCountOnly: "true", f: "json" }, true);
          const n = c.count ?? 0;
          if (n > LOAD_CAP * 1.25) {
            setStatus({ kind: "err", text: `${n.toLocaleString()} parcels there — too many for one map. Add a ward or pick a smaller area.` });
            return;
          }
          setStatus({ kind: "loading", text: `Loading ${n.toLocaleString()} parcels…` });

          let feats: any[] = [];
          for (let offset = 0, page = 0; page < 5; page++) {
            const fc = await request(
              LANDBANK_LAYER + "/query",
              {
                ...spatial,
                outFields: OUT_FIELDS,
                returnGeometry: "true",
                outSR: "4326",
                geometryPrecision: "6",
                resultOffset: String(offset),
                resultRecordCount: "2000",
                f: "geojson",
              },
              true,
            );
            const got = fc.features || [];
            feats = feats.concat(got);
            const more = fc.exceededTransferLimit || fc.properties?.exceededTransferLimit;
            if (!more || got.length === 0) break;
            offset += got.length;
          }

          // Keep only parcels whose center falls inside every chosen boundary.
          const inside = feats.filter((f) => {
            const ctr = f.geometry && bboxCenter(f.geometry);
            return ctr && bounds.every((g) => pointInGeometry(ctr, g));
          });
          if (inside.length > LOAD_CAP) {
            setStatus({ kind: "err", text: `${inside.length.toLocaleString()} parcels — too many for one map. Narrow it with a ward.` });
            return;
          }

          dropUnselected();
          const extra: Record<string, unknown> = {};
          if (h) extra.Neighborhood = h;
          if (w) extra.Ward = w;
          S.lastShown = addFeatures(inside, extra);
          setShown(S.lastShown.length);
          try {
            map.fitBounds(boundary.getBounds(), { padding: [20, 20] });
          } catch {}
          setNote("");
          const area = [h, w && `Ward ${w}`].filter(Boolean).join(" · ");
          setStatus({
            kind: "ok",
            text: inside.length
              ? `${inside.length.toLocaleString()} land bank parcels in ${area}.`
              : `No land bank parcels in ${area}.`,
          });
        } catch (e: any) {
          setStatus({ kind: "err", text: e?.name === "TypeError" ? "Couldn't reach the City's map service. Try again in a moment." : e.message });
        }
      }

      function sync() {
        const pins = [...S.selected].sort();
        setSel(pins.map((p) => ({ pid: p, addr: String(S.info.get(p)?.props.par_addr_all ?? "").split(",")[0] })));
        const out: SelectedParcel[] = [];
        for (const pin of pins) {
          const inf = S.info.get(pin);
          if (inf) out.push({ pid: pin, owner: LANDBANK_OWNER, geometry: inf.geometry, props: inf.props });
        }
        onSel.current(out);
      }
      function toggle(pin: string, force?: boolean) {
        const on = force === undefined ? !S.selected.has(pin) : force;
        if (on) S.selected.add(pin);
        else S.selected.delete(pin);
        restyle(pin);
        sync();
      }

      // shift+drag adds a block; shift+alt+drag removes
      (() => {
        const el = map.getContainer();
        let start: any = null;
        let box: HTMLDivElement | null = null;
        let removing = false;
        const wrap = mapEl.current!;
        el.addEventListener(
          "mousedown",
          (e: MouseEvent) => {
            if (!e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            map.dragging.disable();
            removing = e.altKey;
            const r = el.getBoundingClientRect();
            start = { x: e.clientX - r.left, y: e.clientY - r.top };
            box = document.createElement("div");
            box.className = "box-sel" + (removing ? " remove" : "");
            wrap.appendChild(box);
            Object.assign(box.style, { left: start.x + "px", top: start.y + "px", width: "0px", height: "0px" });
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
          },
          true,
        );
        function move(e: MouseEvent) {
          if (!box) return;
          const r = el.getBoundingClientRect();
          const x = e.clientX - r.left,
            y = e.clientY - r.top;
          Object.assign(box.style, {
            left: Math.min(x, start.x) + "px",
            top: Math.min(y, start.y) + "px",
            width: Math.abs(x - start.x) + "px",
            height: Math.abs(y - start.y) + "px",
          });
        }
        function up(e: MouseEvent) {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          const r = el.getBoundingClientRect();
          const end = { x: e.clientX - r.left, y: e.clientY - r.top };
          if (box) box.remove();
          box = null;
          map.dragging.enable();
          if (Math.abs(end.x - start.x) < 4 && Math.abs(end.y - start.y) < 4) return;
          const b = L.latLngBounds(map.containerPointToLatLng([start.x, start.y]), map.containerPointToLatLng([end.x, end.y]));
          S.byPin.forEach((layer, pin) => {
            if (!b.contains(layer.getBounds().getCenter())) return;
            if (removing) S.selected.delete(pin);
            else S.selected.add(pin);
            restyle(pin);
          });
          sync();
        }
      })();

      function flashNote(t: string) {
        setNote(t);
        setTimeout(() => setNote(""), 2000);
      }

      async function search(q: string) {
        const t = q.trim();
        if (!t) return;
        const key = pinKey(t);
        if (key && /^\d{6,9}[A-Z]?$/.test(key)) {
          if (!S.byPin.has(key)) {
            try {
              const fc = await request(LANDBANK_LAYER + "/query", {
                where: `parcelpin = '${key}'`,
                outFields: OUT_FIELDS,
                outSR: "4326",
                geometryPrecision: "6",
                f: "geojson",
              });
              addFeatures(fc.features || [], {});
            } catch {}
          }
          const l = S.byPin.get(key);
          if (!l) return flashNote(`${dash(key)} isn't a City Land Bank parcel`);
          map.fitBounds(l.getBounds(), { maxZoom: 19 });
          toggle(key, true);
          return;
        }
        try {
          const data = await request("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates", {
            SingleLine: t,
            location: "-81.69,41.48",
            maxLocations: "1",
            f: "json",
          });
          const c = data.candidates && data.candidates[0];
          if (!c) return flashNote("Address not found");
          map.setView([c.location.y, c.location.x], 19);
        } catch {
          flashNote("Address search unavailable — try a parcel number");
        }
      }

      ctrl.current = {
        show,
        search,
        selectAllShown() {
          S.lastShown.forEach((p) => {
            S.selected.add(p);
            restyle(p);
          });
          sync();
        },
        zoomTo(pin: string) {
          const l = S.byPin.get(pin);
          if (l) map.fitBounds(l.getBounds(), { maxZoom: 19 });
        },
        remove(pin: string) {
          toggle(pin, false);
        },
        clear() {
          const pins = [...S.selected];
          S.selected.clear();
          pins.forEach(restyle);
          sync();
        },
        setLabelMode(mode: "pin" | "addr") {
          S.labelMode = mode;
          refreshLabels();
        },
      };

      setTimeout(() => map.invalidateSize(), 200);
    })();

    return () => {
      disposed = true;
      if (map) map.remove();
    };
  }, []);

  const loading = status.kind === "loading";
  const LIST_MAX = 200;

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r">
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-800">City Land Bank parcels</h2>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Neighborhood
            <select
              value={hood}
              onChange={(e) => setHood(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Any neighborhood</option>
              {NEIGHBORHOODS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Ward
            <select
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Any ward</option>
              {WARDS.map((w) => (
                <option key={w} value={w}>
                  Ward {w}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => ctrl.current?.show(hood, ward)}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Show parcels"}
          </button>
          {status.text && (
            <p className={`text-xs ${status.kind === "err" ? "text-red-700" : status.kind === "ok" ? "text-green-700" : "text-slate-500"}`}>
              {status.text}
            </p>
          )}
          {shown > 0 && !loading && (
            <button
              type="button"
              onClick={() => ctrl.current?.selectAllShown()}
              className="rounded-md border border-blue-600 bg-white px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"
            >
              Select all {shown.toLocaleString()} shown
            </button>
          )}
        </section>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-blue-600" />
              <h2 className="text-sm font-semibold">
                {sel.length ? `${sel.length.toLocaleString()} parcel${sel.length === 1 ? "" : "s"} chosen` : "No parcels chosen"}
              </h2>
            </div>
            {sel.length > 0 && (
              <button type="button" onClick={() => ctrl.current?.clear()} className="text-xs text-slate-500 underline">
                Clear
              </button>
            )}
          </div>
          {sel.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Select all, or click parcels on the map to add them.</p>
          ) : (
            <ul className="mt-2 max-h-56 overflow-y-auto border-t border-slate-200">
              {sel.slice(0, LIST_MAX).map((s) => (
                <li key={s.pid} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm">
                  <button type="button" className="font-medium hover:underline" onClick={() => ctrl.current?.zoomTo(s.pid)}>
                    {dash(s.pid)}
                  </button>
                  <span className="flex-1 truncate text-right text-xs text-slate-500">{s.addr}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${dash(s.pid)}`}
                    className="px-1 text-slate-400 hover:text-blue-700"
                    onClick={() => ctrl.current?.remove(s.pid)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {sel.length > LIST_MAX && (
                <li className="py-1.5 text-xs text-slate-500">and {(sel.length - LIST_MAX).toLocaleString()} more…</li>
              )}
            </ul>
          )}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ctrl.current?.search(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a parcel number or address"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold hover:border-slate-400">
            Find
          </button>
        </form>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Labels</span>
          <div className="flex overflow-hidden rounded-md border border-slate-200">
            {(["pin", "addr"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setLabelModeState(m);
                  ctrl.current?.setLabelMode(m);
                }}
                className={`px-3 py-1 text-sm font-semibold ${labelMode === m ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
              >
                {m === "pin" ? "PPN" : "Address"}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-auto border-t border-slate-200 pt-3 text-xs text-slate-500">
          Click a parcel to add or remove it. <b>Shift</b>+drag selects a block; <b>Shift</b>+<b>Alt</b>+drag removes. Picks
          stay when you switch areas, so you can combine neighborhoods.
        </p>
      </aside>

      <div className="relative min-h-[360px]">
        <div ref={mapEl} className="absolute inset-0" />
        {note && <div className="map-note">{note}</div>}
        {hover && (
          <div className="absolute right-3 top-14 z-[500] w-60 rounded-lg border border-slate-200 bg-white/95 p-3 text-sm shadow-md">
            <div className="text-xs uppercase tracking-wide text-slate-400">Land bank parcel</div>
            <div className="font-mono font-medium">{dash(hover.pid)}</div>
            {hover.addr && <div className="mt-1 text-slate-600">{hover.addr.split(",")[0]}</div>}
            {hover.type && <div className="text-xs text-slate-500">{hover.type}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

type Ctrl = {
  show: (hood: string, ward: string) => void;
  search: (q: string) => void;
  selectAllShown: () => void;
  zoomTo: (pin: string) => void;
  remove: (pin: string) => void;
  clear: () => void;
  setLabelMode: (mode: "pin" | "addr") => void;
};

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
