import "maplibre-gl/dist/maplibre-gl.css";
import type { Geometry, Position } from "geojson";
import { useEffect, useRef, useState } from "react";
import MapGL, {
  Layer,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import {
  BASEMAP_STYLE,
  bikeHitLayer,
  bikeLanesLayer,
  bikeSharedDashLayer,
  collisionsLayer,
  hotspotsLayer,
  LAYER_IDS,
  PROTECTION_LABEL,
  TORONTO_CENTER,
  wardFillLayer,
  wardLineLayer,
  wardSelectedLayer,
} from "../mapStyle";
import type {
  ApiFeatureCollection,
  BikeLaneProps,
  CollisionProps,
  HotspotProps,
  LayerToggles,
  WardProps,
} from "../types";

type Fc<P> = ApiFeatureCollection<P> | null;

interface Props {
  wards: Fc<WardProps>;
  collisions: Fc<CollisionProps>;
  bikeLanes: Fc<BikeLaneProps>;
  hotspots: Fc<HotspotProps>;
  layers: LayerToggles;
  selectedWard: number | null;
  onSelectWard: (ward: number | null) => void;
}

type PopupState =
  | { kind: "collision"; lng: number; lat: number; props: CollisionProps }
  | { kind: "bike"; lng: number; lat: number; props: BikeLaneProps }
  | { kind: "hotspot"; lng: number; lat: number; props: HotspotProps };

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function bboxOf(geometry: Geometry): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  const visit = (c: unknown): void => {
    if (typeof (c as Position)[0] === "number") {
      const [x, y] = c as Position;
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    } else {
      for (const child of c as unknown[]) visit(child);
    }
  };
  if ("coordinates" in geometry) visit(geometry.coordinates);
  return [w, s, e, n];
}

export default function MapView({
  wards,
  collisions,
  bikeLanes,
  hotspots,
  layers,
  selectedWard,
  onSelectWard,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [cursor, setCursor] = useState("");

  // Zoom to the ward when one is chosen from the map or the ward picker.
  useEffect(() => {
    if (selectedWard == null || !wards) return;
    const feature = wards.features.find((f) => f.properties.ward_number === selectedWard);
    if (!feature) return;
    const [w, s, e, n] = bboxOf(feature.geometry);
    mapRef.current?.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 40, duration: 700, maxZoom: 14 },
    );
  }, [selectedWard, wards]);

  function handleClick(e: MapLayerMouseEvent): void {
    const features = e.features ?? [];
    const find = (id: string) => features.find((f) => f.layer.id === id);
    const { lng, lat } = e.lngLat;

    const collision = find(LAYER_IDS.collisions);
    if (collision) {
      setPopup({ kind: "collision", lng, lat, props: collision.properties as CollisionProps });
      return;
    }
    const hotspot = find(LAYER_IDS.hotspots);
    if (hotspot) {
      setPopup({ kind: "hotspot", lng, lat, props: hotspot.properties as HotspotProps });
      return;
    }
    const lane = find(LAYER_IDS.bikeHit);
    if (lane) {
      setPopup({ kind: "bike", lng, lat, props: lane.properties as BikeLaneProps });
      return;
    }
    const ward = find(LAYER_IDS.wardFill);
    setPopup(null);
    if (ward) onSelectWard(Number(ward.properties?.ward_number));
  }

  return (
    <MapGL
      ref={mapRef}
      initialViewState={TORONTO_CENTER}
      mapStyle={BASEMAP_STYLE}
      minZoom={9}
      maxBounds={[-79.9, 43.3, -78.9, 44.0]}
      interactiveLayerIds={[
        LAYER_IDS.collisions,
        LAYER_IDS.hotspots,
        LAYER_IDS.bikeHit,
        LAYER_IDS.wardFill,
      ]}
      cursor={cursor}
      onClick={handleClick}
      onMouseEnter={() => setCursor("pointer")}
      onMouseLeave={() => setCursor("")}
    >
      <NavigationControl position="top-right" showCompass={false} />

      <Source id="wards" type="geojson" data={wards ?? EMPTY}>
        <Layer {...wardFillLayer(selectedWard)} />
        <Layer {...wardLineLayer} />
        <Layer {...wardSelectedLayer(selectedWard)} />
      </Source>

      <Source id="bike-lanes" type="geojson" data={bikeLanes ?? EMPTY}>
        <Layer {...bikeLanesLayer(layers.bikeLanes)} />
        <Layer {...bikeSharedDashLayer(layers.bikeLanes)} />
        <Layer {...bikeHitLayer(layers.bikeLanes)} />
      </Source>

      <Source id="hotspots" type="geojson" data={hotspots ?? EMPTY}>
        <Layer {...hotspotsLayer(layers.hotspots)} />
      </Source>

      <Source id="collisions" type="geojson" data={collisions ?? EMPTY}>
        <Layer {...collisionsLayer(layers.collisions)} />
      </Source>

      {popup && (
        <Popup
          longitude={popup.lng}
          latitude={popup.lat}
          maxWidth="280px"
          closeOnClick={false}
          onClose={() => setPopup(null)}
        >
          <PopupBody popup={popup} />
        </Popup>
      )}
    </MapGL>
  );
}

function PopupBody({ popup }: { popup: PopupState }) {
  if (popup.kind === "collision") {
    const p = popup.props;
    const where = [p.stname1, p.stname2].filter(Boolean).join(" & ");
    return (
      <div className="popup">
        <strong>Cyclist KSI collision</strong>
        <div>{p.occurred_on}</div>
        {p.injury && <div>Injury: {p.injury}</div>}
        {where && <div>Near: {where}</div>}
        <small>Police-reported. Location may be generalized.</small>
      </div>
    );
  }
  if (popup.kind === "hotspot") {
    const p = popup.props;
    return (
      <div className="popup">
        <strong>
          #{p.rank} {p.street_name ?? "Unnamed segment"}
        </strong>
        <div>Cyclist KSI on this segment: {p.collision_count}</div>
        <div>Infrastructure: {PROTECTION_LABEL[p.protection_level]}</div>
        <small>
          Ranked by gap score ({p.gap_score}), which combines KSI count and protection level. It
          describes locations only.
        </small>
      </div>
    );
  }
  const p = popup.props;
  const between = [p.from_street, p.to_street].filter(Boolean).join(" to ");
  return (
    <div className="popup">
      <strong>{p.street_name ?? "Bike route"}</strong>
      {between && <div>{between}</div>}
      <div>{p.infra_highorder}</div>
      <div>{PROTECTION_LABEL[p.protection_level]}</div>
      {p.installed_year ? <div>Installed {p.installed_year}</div> : null}
    </div>
  );
}
