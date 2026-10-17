import { useCallback, useEffect, useMemo, useState } from "react";
import { apiUrl, useApi } from "./api";
import CorridorsPanel from "./components/CorridorsPanel";
import LayerControls from "./components/LayerControls";
import MapView from "./components/MapView";
import WardPanel from "./components/WardPanel";
import MethodologyPage from "./pages/MethodologyPage";
import ActionTools from "./components/ActionTools";
import type {
  ApiFeatureCollection,
  BikeLaneProps,
  CollisionProps,
  GapHeatmapPoint,
  GapHeatmapProps,
  HotspotProps,
  LayerToggles,
  Meta,
  WardProps,
} from "./types";

type Page = "map" | "methodology";
type SideTab = "ward" | "corridors";

const LAYER_URLS: Record<"collisions" | "bikeLanes" | "hotspots", string> = {
  collisions: "/api/collisions",
  bikeLanes: "/api/bike-lanes",
  hotspots: "/api/hotspots?limit=20",
};

const DEFAULT_BBOX: [number, number, number, number] = [-79.65, 43.58, -79.12, 43.85];
const DEFAULT_VIEW = { longitude: -79.3832, latitude: 43.6532, zoom: 10.4 };

function readInitialState() {
  const p = new URLSearchParams(window.location.search);
  const number = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(p.get(key)); return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  const defaults: LayerToggles = { collisions: true, bikeLanes: true, hotspots: false, gapHeatmap: false };
  const selected = p.get("layers");
  const layers = selected == null ? defaults : { collisions: selected.includes("c"), bikeLanes: selected.includes("b"), hotspots: selected.includes("h"), gapHeatmap: selected.includes("g") };
  const ward = Number(p.get("ward"));
  return {
    view: { longitude: number("lng", DEFAULT_VIEW.longitude, -79.9, -78.9), latitude: number("lat", DEFAULT_VIEW.latitude, 43.3, 44), zoom: number("z", DEFAULT_VIEW.zoom, 9, 18) },
    layers,
    ward: Number.isInteger(ward) && ward >= 1 && ward <= 25 ? ward : null,
  };
}

export default function App() {
  const [initial] = useState(readInitialState);
  const [page, setPage] = useState<Page>("map");
  const [sideTab, setSideTab] = useState<SideTab>("corridors");
  const [layers, setLayers] = useState<LayerToggles>(initial.layers);
  const [requested, setRequested] = useState<LayerToggles>(layers);
  const [selectedWard, setSelectedWard] = useState<number | null>(initial.ward);
  const [viewportBbox, setViewportBbox] = useState(DEFAULT_BBOX);
  const [viewState, setViewState] = useState(initial.view);
  const [copied, setCopied] = useState(false);
  const [exportLayer, setExportLayer] = useState<"collisions" | "bike-lanes" | "corridors">("collisions");
  const [exportFormat, setExportFormat] = useState<"csv" | "geojson">("geojson");
  const [focusSegmentId, setFocusSegmentId] = useState<number | null>(null);

  const wards = useApi<ApiFeatureCollection<WardProps>>("/api/wards");
  const meta = useApi<Meta>("/api/meta");
  const collisions = useApi<ApiFeatureCollection<CollisionProps>>(
    requested.collisions ? LAYER_URLS.collisions : null,
  );
  const bikeLanes = useApi<ApiFeatureCollection<BikeLaneProps>>(
    requested.bikeLanes ? LAYER_URLS.bikeLanes : null,
  );
  const hotspots = useApi<ApiFeatureCollection<HotspotProps>>(
    requested.hotspots ? LAYER_URLS.hotspots : null,
  );

  const heatmapUrl = useMemo(() => {
    if (!requested.gapHeatmap) return null;
    const [w, s, e, n] = viewportBbox;
    return `/api/gap-heatmap?bbox=${w},${s},${e},${n}&min_gap=0.5&limit=8000`;
  }, [requested.gapHeatmap, viewportBbox]);

  const heatmapFc = useApi<ApiFeatureCollection<GapHeatmapProps>>(heatmapUrl);
  const gapHeatmapPoints: GapHeatmapPoint[] = useMemo(
    () =>
      (heatmapFc.data?.features ?? []).map((f) => ({
        coordinates: f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [0, 0],
        weight: f.properties.weight,
        segment_id: f.properties.segment_id,
      })),
    [heatmapFc.data],
  );

  const summaries = useMemo(() => {
    const map = new Map<number, WardProps>();
    for (const f of wards.data?.features ?? []) map.set(f.properties.ward_number, f.properties);
    return map;
  }, [wards.data]);
  const wardList = useMemo(
    () => [...summaries.values()].sort((a, b) => a.ward_number - b.ward_number),
    [summaries],
  );

  function toggle(key: keyof LayerToggles): void {
    setLayers((l) => {
      const next = { ...l, [key]: !l[key] };
      if (key === "hotspots" && next.hotspots) setSideTab("corridors");
      return next;
    });
    setRequested((r) => ({ ...r, [key]: true }));
  }

  const onFocusComplete = useCallback(() => setFocusSegmentId(null), []);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("lng", viewState.longitude.toFixed(5));
    url.searchParams.set("lat", viewState.latitude.toFixed(5));
    url.searchParams.set("z", viewState.zoom.toFixed(2));
    url.searchParams.set("layers", `${layers.collisions ? "c" : ""}${layers.bikeLanes ? "b" : ""}${layers.hotspots ? "h" : ""}${layers.gapHeatmap ? "g" : ""}`);
    if (selectedWard == null) url.searchParams.delete("ward"); else url.searchParams.set("ward", String(selectedWard));
    window.history.replaceState({}, "", url);
  }, [viewState, layers, selectedWard]);

  async function copyShareUrl(): Promise<void> {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  }

  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({ layer: exportLayer, format: exportFormat });
    if (selectedWard != null) params.set("ward", String(selectedWard));
    else params.set("bbox", viewportBbox.join(","));
    return apiUrl(`/api/exports?${params}`);
  }, [exportLayer, exportFormat, selectedWard, viewportBbox]);

  const refreshed = meta.data?.last_refreshed
    ? new Date(meta.data.last_refreshed).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <div className="shell">
      <header className="topbar">
        <h1>Safe Streets TO</h1>
        <p>Toronto cyclist safety and bike infrastructure. Nonpartisan civic data.</p>
        <nav className="topnav" aria-label="Site sections">
          <button
            type="button"
            className={page === "map" ? "nav-active" : ""}
            onClick={() => setPage("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={page === "methodology" ? "nav-active" : ""}
            onClick={() => setPage("methodology")}
          >
            Methodology
          </button>
        </nav>
        {wards.error && page === "map" && (
          <p className="error" role="alert">
            Could not reach the API: {wards.error}
          </p>
        )}
      </header>
      <aside className="caveat-banner" role="note" aria-label="Data limitations">
        <strong>About these data:</strong> Collision records include police-reported killed or seriously injured (KSI) cyclist incidents only. Locations may be generalized, and near-misses are not included.
      </aside>

      {page === "methodology" ? (
        <main className="methodology-wrap">
          <MethodologyPage />
        </main>
      ) : (
        <div className="workspace">
          <div className="map-wrap">
            <MapView
              wards={wards.data}
              collisions={collisions.data}
              bikeLanes={bikeLanes.data}
              hotspots={hotspots.data}
              gapHeatmap={gapHeatmapPoints}
              layers={layers}
              selectedWard={selectedWard}
              onSelectWard={setSelectedWard}
              onViewportBbox={setViewportBbox}
              initialView={initial.view}
              onViewStateChange={setViewState}
              focusSegmentId={focusSegmentId}
              onFocusComplete={onFocusComplete}
            />
            <LayerControls
              layers={layers}
              onToggle={toggle}
              loading={{
                collisions: collisions.loading,
                bikeLanes: bikeLanes.loading,
                hotspots: hotspots.loading,
                gapHeatmap: heatmapFc.loading,
              }}
              errors={{
                collisions: collisions.error,
                bikeLanes: bikeLanes.error,
                hotspots: hotspots.error,
                gapHeatmap: heatmapFc.error,
              }}
            />
          </div>
          <aside className="side" aria-label="Map sidebar">
            <div className="side-tabs" role="tablist" aria-label="Sidebar panels">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "corridors"}
                className={sideTab === "corridors" ? "tab-active" : ""}
                onClick={() => setSideTab("corridors")}
              >
                Gap corridors
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "ward"}
                className={sideTab === "ward" ? "tab-active" : ""}
                onClick={() => setSideTab("ward")}
              >
                Ward
              </button>
            </div>
            {sideTab === "corridors" ? (
              <CorridorsPanel
                data={hotspots.data}
                loading={hotspots.loading}
                error={hotspots.error}
                onFocusSegment={(id) => {
                  setLayers((l) => ({ ...l, hotspots: true }));
                  setRequested((r) => ({ ...r, hotspots: true }));
                  setFocusSegmentId(id);
                }}
              />
            ) : (
              <WardPanel
                wards={wardList}
                selected={selectedWard}
                onSelect={setSelectedWard}
                summaries={summaries}
              />
            )}
            <ActionTools />
            <section className="share-export" aria-label="Share and export">
              <h3>Share and export</h3>
              <button type="button" onClick={() => void copyShareUrl()}>{copied ? "Link copied" : "Copy map link"}</button>
              <p className="muted">Exports use the selected ward{selectedWard ? ` (${selectedWard})` : ""}; otherwise they use the current map view.</p>
              <label className="field"><span>Data</span><select value={exportLayer} onChange={(e) => setExportLayer(e.target.value as typeof exportLayer)}><option value="collisions">Cyclist KSI collisions</option><option value="bike-lanes">Bike infrastructure</option><option value="corridors">Gap corridors</option></select></label>
              <label className="field"><span>Format</span><select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}><option value="geojson">GeoJSON</option><option value="csv">CSV</option></select></label>
              <a className="download-link" href={exportUrl}>Download export</a>
            </section>
            {!layers.hotspots && sideTab === "corridors" && (
              <p className="muted">Turn on “Top 20 gap corridors” to load the ranked list and map layer.</p>
            )}
          </aside>
        </div>
      )}

      <footer className="footer">
        {refreshed ? `Data last refreshed ${refreshed}. ` : ""}
        Source: City of Toronto Open Data Portal (Open Government Licence – Toronto).
      </footer>
    </div>
  );
}
