import { useMemo, useState } from "react";
import { useApi } from "./api";
import LayerControls from "./components/LayerControls";
import MapView from "./components/MapView";
import WardPanel from "./components/WardPanel";
import type {
  ApiFeatureCollection,
  BikeLaneProps,
  CollisionProps,
  HotspotProps,
  LayerToggles,
  Meta,
  WardProps,
} from "./types";

const LAYER_URLS: Record<keyof LayerToggles, string> = {
  collisions: "/api/collisions",
  bikeLanes: "/api/bike-lanes",
  hotspots: "/api/hotspots?limit=20",
};

export default function App() {
  const [layers, setLayers] = useState<LayerToggles>({
    collisions: true,
    bikeLanes: true,
    hotspots: false,
  });
  // A layer's data is fetched the first time it is switched on, then kept.
  const [requested, setRequested] = useState<LayerToggles>(layers);
  const [selectedWard, setSelectedWard] = useState<number | null>(null);

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
    setLayers((l) => ({ ...l, [key]: !l[key] }));
    setRequested((r) => ({ ...r, [key]: true }));
  }

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
        {wards.error && (
          <p className="error" role="alert">
            Could not reach the API: {wards.error}
          </p>
        )}
      </header>

      <div className="workspace">
        <div className="map-wrap">
          <MapView
            wards={wards.data}
            collisions={collisions.data}
            bikeLanes={bikeLanes.data}
            hotspots={hotspots.data}
            layers={layers}
            selectedWard={selectedWard}
            onSelectWard={setSelectedWard}
          />
          <LayerControls
            layers={layers}
            onToggle={toggle}
            loading={{
              collisions: collisions.loading,
              bikeLanes: bikeLanes.loading,
              hotspots: hotspots.loading,
            }}
            errors={{
              collisions: collisions.error,
              bikeLanes: bikeLanes.error,
              hotspots: hotspots.error,
            }}
          />
        </div>
        <WardPanel
          wards={wardList}
          selected={selectedWard}
          onSelect={setSelectedWard}
          summaries={summaries}
        />
      </div>

      <footer className="footer">
        {refreshed ? `Data last refreshed ${refreshed}. ` : ""}
        Source: City of Toronto Open Data Portal (Open Government Licence – Toronto).
      </footer>
    </div>
  );
}
