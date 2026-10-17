export const CKAN_BASE =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";

/** Toronto Open Data package IDs — resources resolved at runtime via package_show. */
export const PACKAGES = {
  wards: "5e7a8234-f805-43ac-820f-03d7c360b588",
  centreline: "1d079757-377b-4564-82df-eb5638583bfb",
  cyclingNetwork: "abbe5ee3-e249-4f86-a219-f0022eaddcc9",
  ksiCollisions: "73a8e475-9683-42e1-ac06-b8690dcba062",
  requests311: "2e54bc0e-4399-4076-b717-351df5918ae7",
} as const;

/** Most recent three complete 311 calendar-year files; exclude the partial current year. */
const currentYear = new Date().getUTCFullYear();
export const REQUESTS_311_YEARS = [currentYear - 3, currentYear - 2, currentYear - 1] as const;

/** Keep a five-calendar-year window of KSI records, including the current year. */
export const KSI_MIN_YEAR = currentYear - 4;
