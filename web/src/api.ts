import { useEffect, useState } from "react";

export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
export const apiUrl = (path: string) => `${API_BASE}${path}`;

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(apiUrl(url), { signal });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

interface State<T> {
  url: string | null;
  data: T | null;
  error: string | null;
}

/**
 * Fetches `url` whenever it changes. Pass null to stay idle. Data for a URL is kept
 * while the URL stays the same, so keeping the URL set after a layer is toggled off
 * avoids refetching when it is toggled back on.
 */
export function useApi<T>(url: string | null): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const [state, setState] = useState<State<T>>({ url: null, data: null, error: null });

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    getJson<T>(url, controller.signal)
      .then((data) => setState({ url, data, error: null }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ url, data: null, error: err instanceof Error ? err.message : "Request failed" });
      });
    return () => controller.abort();
  }, [url]);

  const current = state.url === url;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: url !== null && !(current && (state.data !== null || state.error !== null)),
  };
}
