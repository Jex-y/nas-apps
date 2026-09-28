import { type FormEvent, useState } from "react";
import {
  LAYER_COLOURS,
  type MapLayer,
  PROPERTY_STATUSES,
  type PropertyStatus,
  STROKE_WIDTHS,
} from "../../../../contract";
import { STATUS_LABELS } from "../../../utils/format";
import { useCreateLayer, useDeleteLayer, useUpdateLayer } from "../api/map";
import type { Tool } from "./DrawingSurface";

const NewLayerForm = ({ onCreated }: { onCreated: (id: string) => void }) => {
  const createLayer = useCreateLayer();
  const [name, setName] = useState("");
  const [colour, setColour] = useState<(typeof LAYER_COLOURS)[number]>(LAYER_COLOURS[0]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createLayer.mutate(
      { name, colour },
      {
        onSuccess: (created) => {
          setName("");
          onCreated(created.id);
        },
      },
    );
  };

  return (
    <form className="new-layer" onSubmit={submit}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New layer, e.g. Avoid"
        aria-label="Layer name"
        maxLength={60}
        required
      />
      <fieldset className="swatches" aria-label="Colour">
        {LAYER_COLOURS.map((option) => (
          <label key={option} className="swatch" style={{ background: option }}>
            <input
              type="radio"
              name="new-layer-colour"
              value={option}
              checked={colour === option}
              onChange={() => setColour(option)}
              aria-label={option}
            />
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={createLayer.isPending}>
        Add layer
      </button>
      {createLayer.error && <p className="error">{createLayer.error.message}</p>}
    </form>
  );
};

const LayerRow = ({
  layer,
  targeted,
  onTarget,
}: {
  layer: MapLayer;
  targeted: boolean;
  onTarget: (id: string) => void;
}) => {
  const updateLayer = useUpdateLayer();
  const deleteLayer = useDeleteLayer();

  const rename = () => {
    const name = window.prompt("Rename layer", layer.name)?.trim();
    if (name && name !== layer.name) {
      updateLayer.mutate({ id: layer.id, update: { name } });
    }
  };

  const remove = () => {
    if (
      layer.strokes.length === 0 ||
      window.confirm(`Delete "${layer.name}" and its ${layer.strokes.length} strokes?`)
    ) {
      deleteLayer.mutate(layer.id);
    }
  };

  return (
    <li className={layer.visible ? "layer" : "layer hidden"}>
      <label className="layer-target">
        <input type="radio" name="target-layer" checked={targeted} onChange={() => onTarget(layer.id)} />
        <span className="swatch" style={{ background: layer.colour }} />
        <span className="layer-name">{layer.name}</span>
      </label>
      <div className="layer-actions">
        <button
          type="button"
          aria-pressed={layer.visible}
          onClick={() => updateLayer.mutate({ id: layer.id, update: { visible: !layer.visible } })}
        >
          {layer.visible ? "Hide" : "Show"}
        </button>
        <button type="button" onClick={rename}>
          Rename
        </button>
        <button type="button" onClick={remove}>
          Delete
        </button>
      </div>
    </li>
  );
};

type Props = {
  readonly layers: readonly MapLayer[];
  readonly target: MapLayer | null;
  readonly onTarget: (id: string) => void;
  readonly tool: Tool;
  readonly onTool: (tool: Tool) => void;
  readonly width: number;
  readonly onWidth: (width: number) => void;
  readonly touchDraws: boolean;
  readonly onTouchDraws: (touchDraws: boolean) => void;
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly shown: ReadonlySet<PropertyStatus>;
  readonly onShown: (shown: ReadonlySet<PropertyStatus>) => void;
};

export const LayerPanel = ({
  layers,
  target,
  onTarget,
  tool,
  onTool,
  width,
  onWidth,
  touchDraws,
  onTouchDraws,
  canUndo,
  onUndo,
  shown,
  onShown,
}: Props) => {
  const toggleStatus = (status: PropertyStatus) => {
    const next = new Set(shown);
    if (!next.delete(status)) {
      next.add(status);
    }
    onShown(next);
  };

  return (
    <aside className="map-panel" aria-label="Map tools">
      <div className="tools">
        <fieldset className="segmented" aria-label="Tool">
          {(["pen", "eraser"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={tool === option} onClick={() => onTool(option)}>
              {option === "pen" ? "Pen" : "Eraser"}
            </button>
          ))}
        </fieldset>
        <fieldset className="segmented" aria-label="Pen width">
          {STROKE_WIDTHS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={width === option}
              aria-label={`${option} pixels`}
              onClick={() => onWidth(option)}
            >
              <span className="width-dot" style={{ width: option, height: option, background: target?.colour }} />
            </button>
          ))}
        </fieldset>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          Undo
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={touchDraws} onChange={(event) => onTouchDraws(event.target.checked)} />
        Draw with finger or mouse
      </label>
      <p className="muted">
        {touchDraws
          ? "Everything draws; untick to pan and zoom."
          : "Apple Pencil draws; fingers pan and zoom. Tap a pin to open it."}
      </p>

      <h2>Layers</h2>
      {layers.length === 0 ? (
        <p className="muted">Add a layer to start drawing.</p>
      ) : (
        <ul className="layers">
          {layers.map((layer) => (
            <LayerRow key={layer.id} layer={layer} targeted={layer.id === target?.id} onTarget={onTarget} />
          ))}
        </ul>
      )}
      <NewLayerForm onCreated={onTarget} />

      <h2>Properties</h2>
      <div className="status-filter">
        {PROPERTY_STATUSES.map((status) => (
          <label key={status} className="check">
            <input type="checkbox" checked={shown.has(status)} onChange={() => toggleStatus(status)} />
            <span className={`status-dot status-${status}`} />
            {STATUS_LABELS[status]}
          </label>
        ))}
      </div>
    </aside>
  );
};
