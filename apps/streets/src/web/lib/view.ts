/** Where the map was last left, so it reopens there and suggestions can start from it. */
export type View = { readonly lat: number; readonly lon: number; readonly zoom: number };

const KEY = "streets:view";
/** Charing Cross, from where London's distances are measured. */
const DEFAULT_VIEW: View = { lat: 51.5074, lon: -0.1278, zoom: 15 };

export const loadView = (): View => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof stored === "object" &&
      stored !== null &&
      "lat" in stored &&
      "lon" in stored &&
      "zoom" in stored &&
      typeof stored.lat === "number" &&
      typeof stored.lon === "number" &&
      typeof stored.zoom === "number"
      ? { lat: stored.lat, lon: stored.lon, zoom: stored.zoom }
      : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
};

export const saveView = (view: View): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    // Private browsing: the map just reopens at the default.
  }
};
