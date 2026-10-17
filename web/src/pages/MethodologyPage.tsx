import { useApi } from "../api";

interface Methodology {
  data_scope: { cyclist_ksi_from_year: number; requests_311_years: number[]; note: string };
  gap_formula: {
    expression: string;
    collision_weight: number;
    protection_penalty: Record<string, number>;
    dead_end_bonus: number;
    dead_end_definition: string;
  };
  protection_level: { radius_m: number; source: string };
  collisions: { filter: string; snap: string };
  ranking: { corridors: string; descriptive_only: string };
  computed_stats: {
    segment_count: number;
    segments_with_cyclist_ksi: number;
    dead_end_segments: number;
    max_gap_score: number;
  } | null;
}

export default function MethodologyPage() {
  const { data, error, loading } = useApi<Methodology>("/api/methodology");

  return (
    <article className="methodology">
      <h2>Methodology</h2>
      <p>
        Safe Streets TO combines Toronto Open Data on cyclist killed-or-seriously-injured (KSI)
        collisions, the cycling network, and centreline street segments. Everything on this site is
        descriptive. We do not rank, endorse, or criticize councillors or candidates.
      </p>

      {loading && <p className="muted">Loading formula details…</p>}
      {error && (
        <p className="error" role="alert">
          Could not load methodology: {error}
        </p>
      )}

      {data && (
        <>
          <h3>Gap score</h3>
          <p>
            Each centreline segment gets a <strong>gap score</strong> stored in{" "}
            <code>segment_stats</code>. Higher scores highlight segments where cyclist KSI counts
            are high and bike infrastructure is weak or drops off.
          </p>
          <pre className="formula">{data.gap_formula.expression}</pre>
          <ul>
            <li>
              <strong>Cyclist KSI count</strong> — collisions snapped to the segment (
              {data.collisions.filter}). Weight: ×{data.gap_formula.collision_weight}.
            </li>
            <li>
              <strong>Protection penalty</strong> — best infrastructure within{" "}
              {data.protection_level.radius_m} m ({data.protection_level.source}): none +
              {data.gap_formula.protection_penalty.none}, shared +
              {data.gap_formula.protection_penalty.shared}, painted +
              {data.gap_formula.protection_penalty.painted}, protected +
              {data.gap_formula.protection_penalty.protected}.
            </li>
            <li>
              <strong>Dead-end bonus</strong> — +{data.gap_formula.dead_end_bonus} when{" "}
              {data.gap_formula.dead_end_definition}
            </li>
          </ul>

          <h3>Ranked corridors</h3>
          <p>{data.ranking.corridors}</p>
          <p className="muted">{data.ranking.descriptive_only}</p>

          <h3>Map layers</h3>
          <ul>
            <li>
              <strong>Top 20 gap corridors</strong> — highest gap scores city-wide, drawn as
              highlighted centreline segments.
            </li>
            <li>
              <strong>Gap heatmap</strong> — hex bins of segment centroids in the current map view,
              weighted by gap score (deck.gl HexagonLayer).
            </li>
          </ul>

          <h3>Data honesty</h3>
          <ul>
            <li>Collision data are police-reported KSI only; locations may be generalized.</li>
            <li>Near-misses and unreported crashes are not included.</li>
            <li>
              311 request locations are approximate when geocoded from intersection street names.
            </li>
          </ul>

          <h3>Data sources and licence</h3>
          <p>
            Records are drawn from the City of Toronto Open Data Portal under the{" "}
            <a href="https://open.toronto.ca/open-government-licence-toronto/" target="_blank" rel="noreferrer">
              Open Government Licence – Toronto
            </a>. The importer keeps cyclist KSI records from {data.data_scope.cyclist_ksi_from_year} onward and the three most recent complete 311 calendar years ({data.data_scope.requests_311_years.join(", ")}).
          </p>
          <ul>
            <li><a href="https://open.toronto.ca/dataset/motor-vehicle-collisions-involving-killed-or-seriously-injured-persons/" target="_blank" rel="noreferrer">Motor Vehicle Collisions Involving Killed or Seriously Injured Persons</a></li>
            <li><a href="https://open.toronto.ca/dataset/cycling-network/" target="_blank" rel="noreferrer">Cycling Network</a></li>
            <li><a href="https://open.toronto.ca/dataset/city-wards/" target="_blank" rel="noreferrer">City Wards</a></li>
            <li><a href="https://open.toronto.ca/dataset/toronto-centreline-tcl/" target="_blank" rel="noreferrer">Toronto Centreline (TCL)</a></li>
            <li><a href="https://open.toronto.ca/dataset/311-service-requests-customer-initiated/" target="_blank" rel="noreferrer">311 Service Requests – Customer Initiated</a></li>
          </ul>
          <p className="muted">{data.data_scope.note}</p>

          {data.computed_stats && (
            <>
              <h3>Current database snapshot</h3>
              <dl className="stats">
                <div>
                  <dt>Centreline segments scored</dt>
                  <dd>{data.computed_stats.segment_count.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Segments with ≥1 cyclist KSI</dt>
                  <dd>{data.computed_stats.segments_with_cyclist_ksi.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Protected dead-end flags</dt>
                  <dd>{data.computed_stats.dead_end_segments.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Maximum gap score</dt>
                  <dd>{data.computed_stats.max_gap_score.toFixed(1)}</dd>
                </div>
              </dl>
            </>
          )}
        </>
      )}
    </article>
  );
}
