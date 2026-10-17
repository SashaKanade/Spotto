import { COLORS } from "../mapStyle";
import type { LayerToggles } from "../types";

interface Props {
  layers: LayerToggles;
  onToggle: (key: keyof LayerToggles) => void;
  loading: Partial<Record<keyof LayerToggles, boolean>>;
  errors: Partial<Record<keyof LayerToggles, string | null>>;
}

function Swatch({ children }: { children: React.ReactNode }) {
  return (
    <svg className="swatch" width="34" height="14" viewBox="0 0 34 14" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function LayerControls({ layers, onToggle, loading, errors }: Props) {
  const rows: { key: keyof LayerToggles; label: string; swatch: React.ReactNode }[] = [
    {
      key: "collisions",
      label: "Cyclist KSI collisions",
      swatch: (
        <Swatch>
          <circle cx="17" cy="7" r="5" fill={COLORS.collision} stroke="#fff" strokeWidth="1.2" />
        </Swatch>
      ),
    },
    {
      key: "bikeLanes",
      label: "Bike lanes",
      swatch: (
        <Swatch>
          <line x1="1" y1="7" x2="33" y2="7" stroke={COLORS.protected} strokeWidth="5" />
        </Swatch>
      ),
    },
    {
      key: "hotspots",
      label: "Top 20 gap corridors",
      swatch: (
        <Swatch>
          <line
            x1="1"
            y1="7"
            x2="33"
            y2="7"
            stroke={COLORS.hotspot}
            strokeWidth="7"
            strokeLinecap="round"
          />
        </Swatch>
      ),
    },
  ];

  return (
    <details className="controls" open>
      <summary>Map layers</summary>
      <fieldset>
        <legend className="sr-only">Choose map layers</legend>
        {rows.map(({ key, label, swatch }) => (
          <label key={key} className="toggle">
            <input type="checkbox" checked={layers[key]} onChange={() => onToggle(key)} />
            {swatch}
            <span>{label}</span>
            {layers[key] && loading[key] && <span className="muted"> loading…</span>}
            {errors[key] && (
              <span className="error" role="alert">
                {" "}
                failed: {errors[key]}
              </span>
            )}
          </label>
        ))}
      </fieldset>

      {layers.bikeLanes && (
        <ul className="legend" aria-label="Bike lane legend">
          <li>
            <Swatch>
              <line x1="1" y1="7" x2="33" y2="7" stroke={COLORS.protected} strokeWidth="5" />
            </Swatch>
            Protected
          </li>
          <li>
            <Swatch>
              <line x1="1" y1="7" x2="33" y2="7" stroke={COLORS.painted} strokeWidth="3" />
            </Swatch>
            Painted lane
          </li>
          <li>
            <Swatch>
              <line
                x1="1"
                y1="7"
                x2="33"
                y2="7"
                stroke={COLORS.shared}
                strokeWidth="3"
                strokeDasharray="4 3"
              />
            </Swatch>
            Shared / signed route
          </li>
        </ul>
      )}
      <p className="note">
        Collisions are police-reported killed or seriously injured (KSI) cyclists only. Locations
        may be generalized, and near-misses are not included.
      </p>
    </details>
  );
}
