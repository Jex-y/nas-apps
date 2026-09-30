import { useEffect, useState } from "react";

/** The theme's colours as the map needs them: plain `rgb()`, since MapLibre cannot read CSS variables or oklch. */
export type MapColours = {
  readonly scheme: "light" | "dark";
  readonly fg: string;
  readonly muted: string;
  readonly surface: string;
  readonly accent: string;
  readonly success: string;
  readonly error: string;
  /** Halfway from `error` to `success`, lifted so the middle of a ramp between them stays bright rather than muddy. */
  readonly between: string;
};

const TOKENS = {
  fg: "--fg",
  muted: "--muted",
  surface: "--surface-raised",
  accent: "--accent",
  success: "--success",
  error: "--error",
} as const;

const BETWEEN = "oklch(from color-mix(in oklch, var(--error), var(--success)) 0.78 c h)";

/**
 * Any CSS colour, variables and all, as `rgb(r g b)`: the element resolves the variables, and painting its colour
 * converts whatever syntax that leaves.
 */
const toRgb = (probe: HTMLElement, context: CanvasRenderingContext2D, colour: string) => {
  probe.style.color = colour;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = getComputedStyle(probe).color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
};

/** `rgb`, from `MapColours`, at `alpha` opacity. */
export const withAlpha = (rgb: string, alpha: number) => rgb.replace(")", ` / ${alpha})`);

const luminance = (rgb: string) => {
  const [r = 0, g = 0, b = 0] = rgb.match(/\d+/g)?.map(Number) ?? [];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const read = (): MapColours => {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("No 2D canvas to resolve the theme's colours");
  }
  const probe = document.body.appendChild(document.createElement("span"));
  try {
    const resolve = (colour: string) => toRgb(probe, context, colour);
    return {
      // A dark ground wants a dark base map, whatever the theme calls itself.
      scheme: luminance(resolve("var(--bg)")) < 0.4 ? "dark" : "light",
      ...(Object.fromEntries(Object.entries(TOKENS).map(([name, token]) => [name, resolve(`var(${token})`)])) as Omit<
        MapColours,
        "scheme" | "between"
      >),
      between: resolve(BETWEEN),
    };
  } finally {
    probe.remove();
  }
};

/** The current theme's colours, updated when the theme or the system colour scheme changes. */
export const useThemeColours = (): MapColours => {
  const [colours, setColours] = useState(read);
  useEffect(() => {
    const refresh = () => setColours(read());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", refresh);
    };
  }, []);
  return colours;
};
