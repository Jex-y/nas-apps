import { useCallback, useMemo, useState } from "react";
import type { MapBounds, MapData } from "../../../../contract";
import { useMapData } from "../api/map";
import { useThemeColours } from "../hooks/useThemeColours";
import { boundsAround, inPlay } from "../utils/features";
import { LayerPanel } from "./LayerPanel";
import { MapCanvas, type MapStart } from "./MapCanvas";
import { OVERLAYS } from "./overlays";
import { SelectedCard } from "./SelectedCard";

/** Matches the stylesheet: a phone folds the layer panel away and the map fills the width. */
const PHONE = "(max-width: 40rem)";

/** The layer panel, `.layer-panel` in the stylesheet: its width and inset, in rem. */
const PANEL_REM = 19 + 0.75;

const EDGE = 48;

/** Every listing on a map, with layers for price, crime and commute places to switch on over it. */
export const MapPage = () => {
  const data = useMapData();
  if (data.error) {
    return <p className="error">{data.error.message}</p>;
  }
  if (data.data === undefined) {
    return <p className="muted">Loading…</p>;
  }
  return <MapView data={data.data} />;
};

const MapView = ({ data }: { data: MapData }) => {
  const colours = useThemeColours();
  const [view, setView] = useState<MapBounds | null>(null);
  const [shown, setShown] = useState<ReadonlySet<string>>(
    () => new Set(OVERLAYS.filter((overlay) => overlay.on).map((overlay) => overlay.id)),
  );
  const [showRejected, setShowRejected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [phone] = useState(() => window.matchMedia(PHONE).matches);
  const start = useMemo((): MapStart | null => {
    const bounds = boundsAround(data.properties.filter(inPlay)) ?? boundsAround(data.properties);
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return bounds === null
      ? null
      : {
          kind: "bounds",
          bounds,
          padding: { top: EDGE, right: EDGE, bottom: EDGE, left: phone ? EDGE : PANEL_REM * rem + EDGE },
        };
  }, [data, phone]);
  const toggle = useCallback(
    (id: string) =>
      setShown((current) => {
        const next = new Set(current);
        if (!next.delete(id)) {
          next.add(id);
        }
        return next;
      }),
    [],
  );
  const chosen = data.properties.find((property) => property.id === selected) ?? null;
  const props = { data, colours, view, selected, onSelect: setSelected, showRejected };

  return (
    <section className="map-page">
      <MapCanvas scheme={colours.scheme} start={start} onMove={setView}>
        {OVERLAYS.map(({ id, Layer }) => (
          <Layer key={id} {...props} visible={shown.has(id)} />
        ))}
      </MapCanvas>
      <LayerPanel {...props} startOpen={!phone} shown={shown} onToggle={toggle} onShowRejected={setShowRejected} />
      {chosen !== null && <SelectedCard property={chosen} onClose={() => setSelected(null)} />}
    </section>
  );
};
