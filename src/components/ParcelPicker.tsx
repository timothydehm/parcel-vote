"use client";

import { useEffect, useRef, useState } from "react";
import { norm, dash } from "@/lib/ppn";
import { DEFAULT_SOURCE, SOURCE_OPTIONS, findPinField, findOwnerField, esriToGeo } from "@/lib/county";
import type { SelectedParcel } from "@/lib/types";

const MIN_ZOOM = 16;
const LABEL_ZOOM = 18;
const CLEVELAND: [number, number] = [41.4925, -81.68];

type Props = { onSelectionChange: (parcels: SelectedParcel[]) => void };

// A live map of county parcels. Pan/zoom and parcels stream in from the county
// ArcGIS service with owner names attached; click (or shift-drag a box) to build
// the set of parcels a voting map will be about.
export default function ParcelPicker({ onSelectionChange }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<Ctrl | null>(null);
  const onSel = useRef(onSelectionChange);
  useEffect(() => {
    onSel.current = onSelectionChange;
  });

  const [sel, setSel] = useState<{ pid: string; owner: string | null }[]>([]);
  const [labelMode, setLabelModeState] = useState<"pin" | "owner">("pin");
  const [ownerQ, setOwnerQ] = useState("");
  const [ownerMsg, setOwnerMsg] = useState("");
  const [srcUrl, setSrcUrl] = useState(DEFAULT_SOURCE);
  const [srcStatus, setSrcStatus] = useState<{ kind: "" | "ok" | "err"; text: string }>({ kind: "", text: "" });
  const [note, setNote] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let disposed = false;
    let map: any;

    (async () => {
      const L = ((await import("leaflet")).default ?? (await import("leaflet"))) as any;
      if (disposed || !mapEl.current) return;

      const S = {
        layerUrl: null as string | null,
        pinField: null as string | null,
        ownerField: null as string | null,
        geojson: false,
        paging: true,
        streets: false,
        byPin: new Map<string, any>(),
        featByPin: new Map<string, { geometry: any; owner: string | null }>(),
        ownerByPin: new Map<string, string>(),
        selected: new Set<string>(),
        fetched: [] as any[],
        ownerQ: "",
        labelMode: "pin" as "pin" | "owner",
      };

      map = L.map(mapEl.current, { boxZoom: false, preferCanvas: true, zoomControl: true }).setView(CLEVELAND, 15);
      const esriAttr = "Imagery & streets &copy; Esri";
      const aerial = L.layerGroup([
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: esriAttr }),
        L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, pane: "overlayPane", opacity: 0.9 }),
      ]);
      const streets = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: esriAttr });
      aerial.addTo(map);
      L.control.layers({ Aerial: aerial, Streets: streets }, null, { position: "topright" }).addTo(map);
      map.attributionControl.addAttribution("Parcels: county GIS");
      map.on("baselayerchange", (e: any) => {
        S.streets = e.layer === streets;
        mapEl.current?.classList.toggle("streets", S.streets);
        restyleAll();
      });

      const ownerMatch = (pin: string) => {
        if (!S.ownerQ) return false;
        const o = S.ownerByPin.get(pin);
        return !!o && o.toLowerCase().includes(S.ownerQ);
      };
      function styleFor(pin: string) {
        const line = S.streets ? "#0f172a" : "#FFFFFF";
        if (S.selected.has(pin)) return { color: "#1d4ed8", weight: 2, opacity: 1, fillColor: "#2563eb", fillOpacity: 0.45 };
        if (ownerMatch(pin)) return { color: "#d97706", weight: 2, opacity: 1, fillColor: "#f59e0b", fillOpacity: 0.35 };
        return { color: line, weight: 1, opacity: S.streets ? 0.6 : 0.85, fillColor: line, fillOpacity: 0.03 };
      }
      const restyle = (pin: string) => {
        const l = S.byPin.get(pin);
        if (l) l.setStyle(styleFor(pin));
      };
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
            if (!S.selected.has(pin)) layer.setStyle({ color: S.streets ? "#0f172a" : "#FFFFFF", weight: 3.5, opacity: 1 });
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
          const byOwner = S.labelMode === "owner";
          const text = byOwner ? S.ownerByPin.get(pin) || "—" : dash(pin);
          labels.addLayer(
            L.marker(c, {
              interactive: false,
              keyboard: false,
              icon: byOwner
                ? L.divIcon({ className: "pin-label owner", html: escapeHtml(text), iconSize: [120, 26], iconAnchor: [60, 13] })
                : L.divIcon({ className: "pin-label", html: text, iconSize: [80, 14], iconAnchor: [40, 7] }),
            }),
          );
          if (++n > 400) break;
        }
      }

      function addFeatures(features: any[]) {
        let added = 0;
        for (const f of features) {
          const pin = norm(f.properties && S.pinField ? f.properties[S.pinField] : null);
          if (!pin || !f.geometry || S.byPin.has(pin)) continue;
          let owner: string | null = null;
          if (S.ownerField) {
            const o = f.properties[S.ownerField];
            if (o != null && String(o).trim()) {
              owner = String(o).trim();
              S.ownerByPin.set(pin, owner);
            }
          }
          S.featByPin.set(pin, { geometry: f.geometry, owner });
          parcels.addData({ type: "Feature", geometry: f.geometry, properties: { __pin: pin } });
          added++;
        }
        if (added) {
          refreshLabels();
          updateOwnerMsg();
        }
        return added;
      }

      async function getJSON(url: string, params: Record<string, string>, signal?: AbortSignal) {
        const qs = new URLSearchParams(params).toString();
        const res = await fetch(url + (qs ? "?" + qs : ""), { signal });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (data && data.error) throw new Error(data.error.message || "Service error");
        return data;
      }

      async function queryParcels(extra: Record<string, string>, signal?: AbortSignal) {
        const outFields = S.ownerField ? `${S.pinField},${S.ownerField}` : String(S.pinField);
        const base: Record<string, string> = { outFields, returnGeometry: "true", outSR: "4326", ...extra };
        let all: any[] = [];
        let offset = 0;
        let paging = S.paging !== false;
        for (let page = 0; page < 6; page++) {
          const params: Record<string, string> = { ...base, f: S.geojson ? "geojson" : "json" };
          if (paging) params.resultOffset = String(offset);
          let data: any;
          try {
            data = await getJSON(S.layerUrl + "/query", params, signal);
          } catch (e: any) {
            if (e.name === "AbortError" || !paging || page > 0) throw e;
            paging = false;
            S.paging = false;
            delete params.resultOffset;
            data = await getJSON(S.layerUrl + "/query", params, signal);
          }
          const feats = S.geojson ? data.features || [] : esriToGeo(data);
          all = all.concat(feats);
          const more = data.exceededTransferLimit || (data.properties && data.properties.exceededTransferLimit);
          if (!more || !feats.length || !paging) break;
          offset += feats.length;
        }
        return all;
      }

      let loadCtl: AbortController | null = null;
      let loadTimer: any = null;
      const covered = (b: any) => S.fetched.some((f) => f.contains(b));
      async function loadView() {
        if (!S.layerUrl) {
          setNote("Set a parcel source to load parcels");
          return;
        }
        if (map.getZoom() < MIN_ZOOM) {
          setNote("Zoom in to load parcels");
          refreshLabels();
          return;
        }
        const b = map.getBounds().pad(0.15);
        if (covered(b)) {
          setNote("");
          refreshLabels();
          return;
        }
        if (loadCtl) loadCtl.abort();
        loadCtl = new AbortController();
        setNote("Loading parcels…");
        try {
          const feats = await queryParcels(
            {
              where: "1=1",
              geometry: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(","),
              geometryType: "esriGeometryEnvelope",
              inSR: "4326",
              spatialRel: "esriSpatialRelIntersects",
            },
            loadCtl.signal,
          );
          addFeatures(feats);
          S.fetched.push(b);
          setNote("");
        } catch (e: any) {
          if (e.name === "AbortError") return;
          setNote("Couldn't load parcels here. Check the parcel source.");
        }
      }
      map.on("moveend", () => {
        clearTimeout(loadTimer);
        loadTimer = setTimeout(loadView, 250);
        refreshLabels();
        updateOwnerMsg();
      });

      function sync() {
        const pins = [...S.selected].sort();
        setSel(pins.map((p) => ({ pid: p, owner: S.ownerByPin.get(p) || null })));
        const out: SelectedParcel[] = [];
        for (const pin of pins) {
          const fb = S.featByPin.get(pin);
          if (fb) out.push({ pid: pin, owner: fb.owner, geometry: fb.geometry });
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

      function matchesInView() {
        if (!S.ownerQ) return [] as string[];
        const view = map.getBounds();
        const out: string[] = [];
        S.byPin.forEach((layer, pin) => {
          if (ownerMatch(pin) && view.contains(layer.getBounds().getCenter())) out.push(pin);
        });
        return out;
      }
      function updateOwnerMsg() {
        if (!S.ownerQ) return setOwnerMsg("");
        if (!S.ownerField) return setOwnerMsg("No owner field on this source.");
        const n = matchesInView().length;
        setOwnerMsg(`${n} owner match${n === 1 ? "" : "es"} in view`);
      }

      const PIN_LOOKUP_CHUNK = 100;
      async function fetchPins(pins: string[]) {
        if (!S.layerUrl) return 0;
        const need = pins.filter((p) => !S.byPin.has(p));
        let added = 0;
        for (let i = 0; i < need.length; i += PIN_LOOKUP_CHUNK) {
          const chunk = need.slice(i, i + PIN_LOOKUP_CHUNK);
          const where = `${S.pinField} IN (${chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(",")})`;
          added += addFeatures(await queryParcels({ where }));
        }
        return added;
      }

      async function connect(raw: string) {
        const url = (raw || "").trim().replace(/\?.*$/, "").replace(/\/+$/, "");
        if (!url) {
          setSrcStatus({ kind: "err", text: "Enter a service URL." });
          return;
        }
        setSrcStatus({ kind: "", text: "Connecting…" });
        try {
          let layerUrl: string | null = null;
          let info: any = null;
          if (/\/(MapServer|FeatureServer)\/\d+$/i.test(url)) {
            info = await getJSON(url, { f: "json" });
            layerUrl = url;
          } else if (/\/(MapServer|FeatureServer)$/i.test(url)) {
            const svc = await getJSON(url, { f: "json" });
            const layers = (svc.layers || []).slice(0, 30);
            const ordered = [...layers.filter((l: any) => /parcel/i.test(l.name)), ...layers.filter((l: any) => !/parcel/i.test(l.name))];
            for (const l of ordered) {
              const li = await getJSON(`${url}/${l.id}`, { f: "json" });
              if (li.geometryType === "esriGeometryPolygon" && findPinField(li.fields)) {
                info = li;
                layerUrl = `${url}/${l.id}`;
                break;
              }
            }
            if (!layerUrl) throw new Error("No polygon layer with a parcel-number field found in that service.");
          } else {
            throw new Error("That doesn't look like an ArcGIS MapServer or FeatureServer URL.");
          }
          const field = findPinField(info.fields);
          if (!field) throw new Error("Couldn't find a parcel-number field on that layer.");
          const ownerField = findOwnerField(info.fields);
          S.ownerByPin.clear();
          S.featByPin.clear();
          Object.assign(S, {
            layerUrl,
            pinField: field,
            ownerField,
            fetched: [],
            geojson: /geojson/i.test(info.supportedQueryFormats || ""),
            paging: !(info.advancedQueryCapabilities && info.advancedQueryCapabilities.supportsPagination === false),
          });
          parcels.clearLayers();
          S.byPin.clear();
          labels.clearLayers();
          setSrcStatus({ kind: "ok", text: `Connected to ${info.name || "parcel layer"} · owner: ${ownerField || "none found"}` });
          loadView();
        } catch (e: any) {
          setSrcStatus({
            kind: "err",
            text: e.name === "TypeError" ? "Couldn't reach that service from the browser. Try another source URL." : e.message,
          });
          setNote("Set a parcel source to load parcels");
        }
      }

      // box select: shift+drag adds, shift+alt+drag removes
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
          const bounds = L.latLngBounds(map.containerPointToLatLng([start.x, start.y]), map.containerPointToLatLng([end.x, end.y]));
          S.byPin.forEach((layer, pin) => {
            if (!bounds.contains(layer.getBounds().getCenter())) return;
            if (removing) S.selected.delete(pin);
            else S.selected.add(pin);
            restyle(pin);
          });
          sync();
        }
      })();

      async function search(q: string) {
        const t = q.trim();
        if (!t) return;
        const digits = t.replace(/[\s-]/g, "");
        if (/^\d{6,9}$/.test(digits)) {
          const pin = norm(digits)!;
          try {
            await fetchPins([pin]);
          } catch {}
          const l = S.byPin.get(pin);
          if (!l) {
            setNote(`${dash(pin)} not found`);
            setTimeout(() => setNote(""), 1800);
            return;
          }
          map.fitBounds(l.getBounds(), { maxZoom: 19 });
          toggle(pin, true);
          return;
        }
        try {
          const data = await getJSON("https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates", {
            SingleLine: t,
            location: "-81.69,41.48",
            maxLocations: "1",
            outFields: "Match_addr",
            f: "json",
          });
          const c = data.candidates && data.candidates[0];
          if (!c) {
            setNote("Address not found");
            setTimeout(() => setNote(""), 1800);
            return;
          }
          map.setView([c.location.y, c.location.x], 19);
        } catch {
          setNote("Address search unavailable — try a parcel number");
          setTimeout(() => setNote(""), 2000);
        }
      }

      ctrl.current = {
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
        setLabelMode(mode: "pin" | "owner") {
          S.labelMode = mode;
          refreshLabels();
        },
        setOwnerQuery(q: string) {
          S.ownerQ = q.trim().toLowerCase();
          restyleAll();
          updateOwnerMsg();
        },
        selectOwnerMatches() {
          matchesInView().forEach((p) => {
            S.selected.add(p);
            restyle(p);
          });
          sync();
        },
        connect,
        search,
      };

      connect(DEFAULT_SOURCE);
      setTimeout(() => map.invalidateSize(), 200);
    })();

    return () => {
      disposed = true;
      if (map) map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_1fr]">
      <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b border-slate-200 bg-slate-50 p-4 md:border-b-0 md:border-r">
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
            placeholder="Parcel number or address"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          <button type="submit" className="rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold hover:border-slate-400">
            Find
          </button>
        </form>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Labels</span>
            <div className="flex overflow-hidden rounded-md border border-slate-200">
              {(["pin", "owner"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setLabelModeState(m);
                    ctrl.current?.setLabelMode(m);
                  }}
                  className={`px-3 py-1 text-sm font-semibold ${labelMode === m ? "bg-slate-800 text-white" : "bg-white text-slate-700"}`}
                >
                  {m === "pin" ? "PPN" : "Owner"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            Highlight owners containing
            <div className="flex gap-2">
              <input
                value={ownerQ}
                onChange={(e) => {
                  setOwnerQ(e.target.value);
                  ctrl.current?.setOwnerQuery(e.target.value);
                }}
                placeholder="Part of an owner name"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => ctrl.current?.selectOwnerMatches()}
                className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold hover:border-slate-400"
              >
                Select these
              </button>
            </div>
          </label>
          {ownerMsg && <p className="text-xs text-slate-500">{ownerMsg}</p>}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-blue-600" />
              <h2 className="text-sm font-semibold">
                {sel.length ? `${sel.length} parcel${sel.length === 1 ? "" : "s"} chosen` : "No parcels chosen"}
              </h2>
            </div>
            {sel.length > 0 && (
              <button type="button" onClick={() => ctrl.current?.clear()} className="text-xs text-slate-500 underline">
                Clear
              </button>
            )}
          </div>
          {sel.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Click parcels on the map to add them here.</p>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto border-t border-slate-200">
              {sel.map((s) => (
                <li key={s.pid} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm">
                  <button type="button" className="font-medium hover:underline" onClick={() => ctrl.current?.zoomTo(s.pid)}>
                    {dash(s.pid)}
                  </button>
                  <span className="flex-1 truncate text-right text-xs text-slate-500">{s.owner || ""}</span>
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
            </ul>
          )}
        </div>

        <details open={showSource} onToggle={(e) => setShowSource((e.target as HTMLDetailsElement).open)} className="border-t border-slate-200 pt-3">
          <summary className="cursor-pointer text-sm font-semibold">Parcel source</summary>
          <div className="mt-2 flex flex-col gap-2">
            <input
              value={srcUrl}
              onChange={(e) => setSrcUrl(e.target.value)}
              list="src-options"
              spellCheck={false}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <datalist id="src-options">
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.url} value={o.url}>
                  {o.label}
                </option>
              ))}
            </datalist>
            <button
              type="button"
              onClick={() => ctrl.current?.connect(srcUrl)}
              className="self-start rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:border-slate-400"
            >
              Connect
            </button>
            {srcStatus.text && (
              <p className={`text-xs ${srcStatus.kind === "err" ? "text-red-700" : srcStatus.kind === "ok" ? "text-green-700" : "text-slate-500"}`}>
                {srcStatus.text}
              </p>
            )}
          </div>
        </details>

        <p className="mt-auto border-t border-slate-200 pt-3 text-xs text-slate-500">
          Click a parcel to add or remove it. <b>Shift</b>+drag selects a block; <b>Shift</b>+<b>Alt</b>+drag removes.
        </p>
      </aside>

      <div className="relative min-h-[360px]">
        <div ref={mapEl} className="absolute inset-0" />
        {note && <div className="map-note">{note}</div>}
      </div>
    </div>
  );
}

type Ctrl = {
  zoomTo: (pin: string) => void;
  remove: (pin: string) => void;
  clear: () => void;
  setLabelMode: (mode: "pin" | "owner") => void;
  setOwnerQuery: (q: string) => void;
  selectOwnerMatches: () => void;
  connect: (url: string) => void;
  search: (q: string) => void;
};

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
