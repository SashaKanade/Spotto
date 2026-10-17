import { PROTECTION_LABEL } from "../mapStyle";
import type { ApiFeatureCollection, HotspotProps } from "../types";

interface Props {
  data: ApiFeatureCollection<HotspotProps> | null;
  loading: boolean;
  error: string | null;
  onFocusSegment: (segmentId: number) => void;
}

export default function CorridorsPanel({
  data,
  loading,
  error,
  onFocusSegment,
}: Props) {
  return (
    <section className="corridors" aria-labelledby="corridors-heading">
      <h3 id="corridors-heading">Top 20 gap corridors</h3>
      <p className="muted corridor-intro">
        Street segments with the highest gap scores city-wide. Descriptive only — ranks locations,
        not people or politicians.
      </p>
      {loading && <p className="muted">Loading rankings…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <ol className="corridor-list">
          {data.features.map((f) => {
            const p = f.properties;
            return (
              <li key={p.id}>
                <button type="button" className="corridor-btn" onClick={() => onFocusSegment(p.id)}>
                  <span className="corridor-rank">#{p.rank}</span>
                  <span className="corridor-name">{p.street_name ?? `Segment ${p.id}`}</span>
                  <span className="corridor-meta">
                    Score {p.gap_score.toFixed(1)} · {p.collision_count} KSI ·{" "}
                    {PROTECTION_LABEL[p.protection_level].split("(")[0].trim()}
                    {p.dead_end_protected ? " · protected dead-end" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {data?.meta?.note && <p className="note">{data.meta.note}</p>}
    </section>
  );
}
