import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../api";
import { COLORS } from "../mapStyle";
import type { WardDetail, WardProps } from "../types";
import { apiUrl } from "../api";

interface Props {
  wards: { ward_number: number; name: string }[];
  selected: number | null;
  onSelect: (ward: number | null) => void;
  summaries: Map<number, WardProps>;
}

const km = (n: number) => `${n.toFixed(1)} km`;

export default function WardPanel({ wards, selected, onSelect, summaries }: Props) {
  const [briefing, setBriefing] = useState("");
  const [briefingError, setBriefingError] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);
  async function loadBriefing(): Promise<void> {
    if (selected == null) return;
    setBriefingLoading(true); setBriefingError("");
    try {
      const response = await fetch(apiUrl(`/api/ward/${selected}/briefing`), { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create briefing");
      setBriefing(body.summary);
    } catch (e) { setBriefingError(e instanceof Error ? e.message : "Could not create briefing"); }
    finally { setBriefingLoading(false); }
  }
  const { data, error, loading } = useApi<WardDetail>(
    selected == null ? null : `/api/wards/${selected}`,
  );

  return (
    <div className="ward-panel" aria-label="Ward details">
      <label className="field">
        <span>Ward</span>
        <select
          value={selected ?? ""}
          onChange={(e) => onSelect(e.target.value === "" ? null : Number(e.target.value))}
        >
          <option value="">Select a ward (or click the map)</option>
          {wards.map((w) => (
            <option key={w.ward_number} value={w.ward_number}>
              {w.ward_number} – {w.name}
            </option>
          ))}
        </select>
      </label>

      {selected == null && (
        <p className="muted">
          Choose a ward to see cyclist KSI by year, bike lane length, and 311 bike-related
          requests. Statistics are descriptive only.
        </p>
      )}

      {selected != null && (
        <section aria-live="polite">
          <h2>
            Ward {selected}
            {summaries.get(selected) ? ` – ${summaries.get(selected)?.name}` : ""}
          </h2>
          {loading && <p className="muted">Loading ward data…</p>}
          {error && (
            <p className="error" role="alert">
              Could not load ward data: {error}
            </p>
          )}
          {data && <WardStats d={data} />}
          <section className="ward-briefing">
            <h3>Ward briefing</h3>
            <p className="muted">A plain-language summary from ward statistics.</p>
            <button type="button" onClick={() => void loadBriefing()} disabled={briefingLoading}>{briefingLoading ? "Preparing…" : "Create briefing"}</button>
            {briefingError && <p className="error" role="alert">{briefingError}</p>}
            {briefing && <p aria-live="polite">{briefing}</p>}
          </section>
        </section>
      )}
    </div>
  );
}

function WardStats({ d }: { d: WardDetail }) {
  const near = d.ksi_near_protected_lane;
  const r = d.requests_311;
  const maxYear = d.ksi_by_year.reduce((m, y) => Math.max(m, y.count), 0);

  return (
    <>
      <dl className="stats">
        <div>
          <dt>Cyclist KSI collisions</dt>
          <dd>{d.ksi_total}</dd>
        </div>
        <div>
          <dt>Protected lanes</dt>
          <dd>{km(d.km_by_protection.protected)}</dd>
        </div>
        <div>
          <dt>Painted lanes</dt>
          <dd>{km(d.km_by_protection.painted)}</dd>
        </div>
        <div>
          <dt>Shared routes</dt>
          <dd>{km(d.km_by_protection.shared)}</dd>
        </div>
      </dl>

      <h3>Cyclist KSI by year</h3>
      {d.ksi_by_year.length === 0 ? (
        <p className="muted">No cyclist KSI collisions recorded in this ward.</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={`Bar chart of cyclist KSI collisions per year in ward ${d.ward_number}. Table below has the same numbers.`}
          >
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={d.ksi_by_year} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid vertical={false} stroke="#e3e6ea" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} domain={[0, Math.max(maxYear, 1)]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [String(v), "Collisions"]} />
                <Bar dataKey="count" fill={COLORS.collision} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary>View as table</summary>
            <table>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Collisions</th>
                </tr>
              </thead>
              <tbody>
                {d.ksi_by_year.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td>{y.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}

      <h3>Collisions near protected lanes</h3>
      {near.share == null ? (
        <p className="muted">No collisions to compare.</p>
      ) : (
        <p>
          {near.within_100m} of {near.total} cyclist KSI collisions ({Math.round(near.share * 100)}
          %) were within 100 m of a protected lane.
        </p>
      )}

      <h3>311 bike-related requests</h3>
      <p>
        {r.total} request{r.total === 1 ? "" : "s"}
        {r.first_year && r.last_year
          ? ` (${r.first_year === r.last_year ? r.first_year : `${r.first_year}–${r.last_year}`})`
          : ""}
        .{" "}
        {r.median_days_to_close != null
          ? `Median time to close: ${r.median_days_to_close.toFixed(1)} days (${r.closed} closed).`
          : "Time to close is not available in the loaded data."}
      </p>
    </>
  );
}
