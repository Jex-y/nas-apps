/** 24×24 stroked paths, drawn in the text colour. */
const PATHS = {
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  check: "M5 12.5l4.5 4.5L19 7.5",
  settings: "M4 7h9M17 7h3M13 7a2 2 0 104 0 2 2 0 10-4 0M4 17h3M11 17h9M7 17a2 2 0 104 0 2 2 0 10-4 0",
  log: "M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12",
  history: "M5 4h14v16H5zM5 9h14M9 4v5M15 4v5",
  exercises: "M4 19h16M7 16v-5M12 16V6M17 16v-8",
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({ name }: { readonly name: IconName }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={PATHS[name]} />
  </svg>
);
