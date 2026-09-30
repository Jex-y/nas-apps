import { useState } from "react";
import type { OverlayProps } from "./overlay";
import { OVERLAYS } from "./overlays";

/** The overlays, each with a switch and, when on, its legend; folds away on a phone to leave the map. */
export const LayerPanel = ({
  startOpen,
  shown,
  onToggle,
  onShowRejected,
  ...props
}: Omit<OverlayProps, "visible"> & {
  startOpen: boolean;
  shown: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onShowRejected: (show: boolean) => void;
}) => {
  const [open, setOpen] = useState(startOpen);
  return (
    <aside className={open ? "layer-panel open" : "layer-panel"} aria-label="Map layers">
      <button type="button" className="layer-panel-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Layers <span className="muted">{shown.size}</span>
      </button>
      {open && (
        <div className="layer-panel-body">
          <ul className="layer-list">
            {[...OVERLAYS].reverse().map(({ id, label, description, Legend }) => {
              const on = shown.has(id);
              return (
                <li key={id} className={on ? "layer on" : "layer"}>
                  <label className="layer-heading">
                    <span className="switch">
                      <input type="checkbox" checked={on} onChange={() => onToggle(id)} />
                    </span>
                    <span className="layer-name">
                      <span>{label}</span>
                      <span className="muted">{description}</span>
                    </span>
                  </label>
                  {on && Legend && <Legend {...props} visible={on} />}
                  {on && id === "listings" && (
                    <label className="toggle layer-option">
                      <input
                        type="checkbox"
                        checked={props.showRejected}
                        onChange={(event) => onShowRejected(event.target.checked)}
                      />
                      Show rejected
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
};
