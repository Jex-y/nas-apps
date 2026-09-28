import type { ReactNode } from "react";
import type { Probed } from "../../../../contract";

export const ProbeView = <T,>({
  probe,
  children,
}: {
  readonly probe: Probed<T>;
  readonly children: (value: T) => ReactNode;
}) => (probe.status === "ok" ? children(probe.value) : <p className="error">Unavailable: {probe.error}</p>);

export const StatusDot = ({ up }: { readonly up: boolean }) => (
  <span className={up ? "dot up" : "dot down"} role="img" aria-label={up ? "Up" : "Down"} />
);

/** One labelled figure inside a `<dl className="facts">`. */
export const Fact = ({ label, children }: { readonly label: string; readonly children: ReactNode }) => (
  <div className="fact">
    <dt>{label}</dt>
    <dd className="figure">{children}</dd>
  </div>
);
