import type { LayerProps } from "react-map-gl/maplibre";
import type { ProtectionLevel } from "./types";

/** Free basemap (CARTO Positron, no API key). */
export const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

export const TORONTO_CENTER = { longitude: -79.3832, latitude: 43.6532, zoom: 10.8 };

/**
 * Colorblind-safe palette (Okabe-Ito). Protection level is also encoded by line
 * width and dash pattern so colour is never the only cue.
 */
export const COLORS = {
  protected: "#0072B2",
  painted: "#E69F00",
  shared: "#009E73",
  collision: "#D55E00",
  hotspot: "#CC79A7",
  ward: "#4a4f57",
  wardSelected: "#111111",
} as const;

export const PROTECTION_LABEL: Record<ProtectionLevel, string> = {
  protected: "Protected (cycle track, buffered lane, trail)",
  painted: "Painted bike lane",
  shared: "Shared / signed route",
  none: "No bike infrastructure",
};

export const LAYER_IDS = {
  wardFill: "ward-fill",
  wardLine: "ward-line",
  wardSelected: "ward-selected",
  bikeHit: "bike-hit",
  bikeLanes: "bike-lanes",
  hotspots: "hotspots",
  collisions: "collisions",
} as const;

const vis = (on: boolean) => ({ visibility: on ? ("visible" as const) : ("none" as const) });

export function wardFillLayer(selected: number | null): LayerProps {
  return {
    id: LAYER_IDS.wardFill,
    type: "fill",
    paint: {
      "fill-color": COLORS.ward,
      "fill-opacity": ["case", ["==", ["get", "ward_number"], selected ?? -1], 0.1, 0.02],
    },
  };
}

export const wardLineLayer: LayerProps = {
  id: LAYER_IDS.wardLine,
  type: "line",
  paint: { "line-color": COLORS.ward, "line-width": 1, "line-opacity": 0.55 },
};

export function wardSelectedLayer(selected: number | null): LayerProps {
  return {
    id: LAYER_IDS.wardSelected,
    type: "line",
    filter: ["==", ["get", "ward_number"], selected ?? -1],
    paint: { "line-color": COLORS.wardSelected, "line-width": 2.5 },
  };
}

/** Invisible, wider line so thin bike lanes are easy to click or tap. */
export function bikeHitLayer(on: boolean): LayerProps {
  return {
    id: LAYER_IDS.bikeHit,
    type: "line",
    layout: { ...vis(on), "line-cap": "round" },
    paint: { "line-color": "#000000", "line-opacity": 0.01, "line-width": 12 },
  };
}

export function bikeLanesLayer(on: boolean): LayerProps {
  return {
    id: LAYER_IDS.bikeLanes,
    type: "line",
    layout: { ...vis(on), "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "match",
        ["get", "protection_level"],
        "protected",
        COLORS.protected,
        "painted",
        COLORS.painted,
        "shared",
        COLORS.shared,
        "#888888",
      ],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        10,
        ["match", ["get", "protection_level"], "protected", 2, 1.2],
        15,
        ["match", ["get", "protection_level"], "protected", 5, 3],
      ],
    },
  };
}

/** Shared lanes are dashed; this layer sits on top of the base line to cut gaps into it. */
export function bikeSharedDashLayer(on: boolean): LayerProps {
  return {
    id: "bike-lanes-shared-gap",
    type: "line",
    filter: ["==", ["get", "protection_level"], "shared"],
    layout: { ...vis(on) },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 15, 3.4],
      "line-dasharray": [1.5, 1.5],
    },
  };
}

export function hotspotsLayer(on: boolean): LayerProps {
  return {
    id: LAYER_IDS.hotspots,
    type: "line",
    layout: { ...vis(on), "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": COLORS.hotspot,
      "line-width": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 9],
      "line-opacity": 0.9,
    },
  };
}

export function collisionsLayer(on: boolean): LayerProps {
  return {
    id: LAYER_IDS.collisions,
    type: "circle",
    layout: { ...vis(on) },
    paint: {
      "circle-color": COLORS.collision,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.9,
    },
  };
}
