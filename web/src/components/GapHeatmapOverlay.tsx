import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { useControl } from "react-map-gl/maplibre";
import type { GapHeatmapPoint } from "../types";

/** Colorblind-safe heat ramp (low → high gap score). */
const COLOR_RANGE: [number, number, number][] = [
  [254, 240, 217],
  [253, 204, 138],
  [252, 141, 89],
  [227, 74, 51],
  [127, 39, 4],
];

interface Props {
  points: GapHeatmapPoint[];
  visible: boolean;
}

function DeckOverlay({ points, visible }: Props) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay({ interleaved: true }));

  overlay.setProps({
    layers: [
      new HexagonLayer<GapHeatmapPoint>({
        id: "gap-hexbin",
        data: points,
        visible,
        pickable: false,
        extruded: false,
        radius: 280,
        coverage: 0.85,
        elevationScale: 0,
        getPosition: (d) => d.coordinates,
        getColorWeight: (d: GapHeatmapPoint) => d.weight,
        colorAggregation: "SUM",
        colorRange: COLOR_RANGE,
        opacity: visible ? 0.75 : 0,
        updateTriggers: {
          getPosition: points,
          getColorWeight: points,
        },
      }),
    ],
  });

  return null;
}

export default function GapHeatmapOverlay(props: Props) {
  if (!props.visible && props.points.length === 0) return null;
  return <DeckOverlay {...props} />;
}
