import { useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "../api";

interface LocationSummary { count: number; first_year: number | null; last_year: number | null; ward_number: number | null; ward_name: string | null; radius_m: number; caveat: string }
interface SearchResult { id: number; lat: number; lng: number; label: string }
interface SearchResponse { results: SearchResult[] }

export default function ActionTools({
  selectedLocation,
  onNavigateToLocation,
}: {
  selectedLocation: { lat: number; lng: number } | null;
  onNavigateToLocation: (location: { lat: number; lng: number }) => void;
}) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [intersection, setIntersection] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [issue, setIssue] = useState("A bike-related street or cycling infrastructure issue");
  const [message, setMessage] = useState("");
  const [report, setReport] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedLocation) {
      setLat(selectedLocation.lat.toFixed(5));
      setLng(selectedLocation.lng.toFixed(5));
    }
  }, [selectedLocation]);

  async function searchPlaces(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const query = searchQuery.trim();
    if (query.length < 3) {
      setSearchError("Enter at least 3 characters to search.");
      setSearchResults([]);
      return;
    }

    setSearchBusy(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const response = await fetch(apiUrl(`/api/geocode?q=${encodeURIComponent(query)}`));
      const body = (await response.json()) as SearchResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Place search is temporarily unavailable.");
      if (body.results.length === 0) {
        setSearchError("No matching Toronto address or intersection found.");
      } else {
        setSearchResults(body.results);
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Place search is temporarily unavailable.");
    } finally {
      setSearchBusy(false);
    }
  }

  function choosePlace(result: SearchResult): void {
    const location = { lat: result.lat, lng: result.lng };
    setLat(result.lat.toFixed(5));
    setLng(result.lng.toFixed(5));
    setIntersection(result.label);
    setSearchQuery(result.label);
    setSearchResults([]);
    onNavigateToLocation(location);
  }

  async function generate(): Promise<void> {
    if (!lat.trim() || !lng.trim() || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      setError("Click a location on the map or enter valid latitude and longitude first.");
      return;
    }
    setBusy(true); setError(""); setMessage("");
    try {
      const params = new URLSearchParams({ lat, lng, radius_m: "300" });
      const response = await fetch(apiUrl(`/api/actions/location-summary?${params}`));
      if (!response.ok) throw new Error((await response.json()).error ?? "Could not load nearby data");
      const d = (await response.json()) as LocationSummary;
      const dateSpan = d.first_year && d.last_year ? ` from ${d.first_year}${d.first_year === d.last_year ? "" : ` to ${d.last_year}`}` : "";
      setMessage(`Hello Councillor,\n\nI am writing about cycling safety near ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}${d.ward_number ? ` in Ward ${d.ward_number}${d.ward_name ? ` (${d.ward_name})` : ""}` : ""}. Within 300 m, the available data records ${d.count} police-reported cyclist KSI collision${d.count === 1 ? "" : "s"}${dateSpan}.\n\nCould you share what information the City has about this location and what options are being considered to address the issue?\n\nThank you.`);
      const coordinateLabel = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
      const locationLabel = intersection.trim()
        ? `at ${intersection.trim()} (map coordinates ${coordinateLabel})`
        : `near ${coordinateLabel}`;
      setReport(`I am reporting a cycling-related concern ${locationLabel}. Issue: ${issue.trim() || "Cycling-related concern"}. Please review the location and advise on next steps.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not generate text"); }
    finally { setBusy(false); }
  }

  async function copy(value: string): Promise<void> { await navigator.clipboard.writeText(value); }

  return <section className="action-tools" aria-label="Action text generators">
    <h3>Action text generators</h3>
    <p className="muted">Click a location on the map, or enter its coordinates, to create a 311 draft and a data-based message. Review and edit before sending.</p>
    <form className="place-search" onSubmit={(event) => void searchPlaces(event)}>
      <label className="field">
        <span>Find an address or intersection</span>
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="e.g., Queen St W & Spadina Ave"
          maxLength={120}
        />
      </label>
      <button type="submit" className="place-search-submit" disabled={searchBusy}>
        {searchBusy ? "Searching…" : "Search map"}
      </button>
      <p className="search-attribution">
        Search goes to OpenStreetMap Nominatim. Avoid private information. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
      </p>
      {searchError && <p className="error" role="alert">{searchError}</p>}
      {searchResults.length > 0 && (
        <ul className="place-results" aria-label="Search results">
          {searchResults.map((result) => (
            <li key={result.id}>
              <button type="button" className="place-result" onClick={() => choosePlace(result)}>
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
    <div className="coordinate-grid">
      <label className="field"><span>Latitude</span><input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" /></label>
      <label className="field"><span>Longitude</span><input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" /></label>
    </div>
    <label className="field"><span>Street intersection or address (optional)</span><input value={intersection} onChange={(e) => setIntersection(e.target.value)} placeholder="e.g., Queen St W & Spadina Ave" /></label>
    <label className="field"><span>311 issue</span><textarea rows={2} value={issue} onChange={(e) => setIssue(e.target.value)} maxLength={500} /></label>
    <button type="button" className="action-button" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate drafts"}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {report && <div className="generated"><h4>311 report draft</h4><textarea aria-label="311 report draft" rows={4} value={report} onChange={(e) => setReport(e.target.value)} /><p><a href="https://www.toronto.ca/home/311-toronto-at-your-service/" target="_blank" rel="noreferrer">Open the City’s 311 service</a> <button type="button" onClick={() => void copy(report)}>Copy draft</button></p></div>}
    {message && <div className="generated"><h4>Message draft</h4><textarea aria-label="Message draft" rows={7} value={message} onChange={(e) => setMessage(e.target.value)} /><p><button type="button" onClick={() => void copy(message)}>Copy message</button></p><small>Police-reported KSI only; locations may be generalized. Near-misses are not included.</small></div>}
  </section>;
}
