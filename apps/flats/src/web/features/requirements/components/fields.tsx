import { type ReactNode, useEffect, useId, useState } from "react";

const show = (value: number | null) => (value === null ? "" : String(Number(value.toFixed(6))));

/**
 * A number typed freely: "-", "0." or "" stay on screen while typing and only a whole number reaches `onChange`.
 * With `nullable`, clearing it sends `null`, e.g. to leave a bound open.
 */
export const NumberField = ({
  label,
  value,
  onChange,
  step = 1,
  unit,
  nullable = false,
  placeholder,
  stepper = false,
  hideLabel = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  unit?: string;
  nullable?: boolean;
  placeholder?: string;
  stepper?: boolean;
  hideLabel?: boolean;
}) => {
  const id = useId();
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((typed) => (typed.trim() !== "" && Number(typed) === value ? typed : show(value)));
  }, [value]);

  const commit = (typed: string) => {
    setText(typed);
    if (typed.trim() === "") {
      if (nullable) {
        onChange(null);
      }
      return;
    }
    const parsed = Number(typed);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
    }
  };
  const nudge = (direction: 1 | -1) => commit(show(Number(((value ?? 0) + direction * step).toFixed(6))));

  return (
    <span className="number-field">
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : "field-label"}>
        {label}
      </label>
      <span className="number-control">
        {stepper && (
          <button
            type="button"
            className="stepper"
            tabIndex={-1}
            aria-label={`Less ${label}`}
            onClick={() => nudge(-1)}
          >
            −
          </button>
        )}
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onChange={(event) => commit(event.target.value)}
          onBlur={() => setText(show(value))}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              nudge(event.key === "ArrowUp" ? 1 : -1);
            }
          }}
        />
        {stepper && (
          <button type="button" className="stepper" tabIndex={-1} aria-label={`More ${label}`} onClick={() => nudge(1)}>
            +
          </button>
        )}
        {unit && <span className="unit">{unit}</span>}
      </span>
    </span>
  );
};

export const TextField = ({
  label,
  value,
  onChange,
  hideLabel = false,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hideLabel?: boolean;
  className?: string;
}) => {
  const id = useId();
  return (
    <span className={className ? `text-field ${className}` : "text-field"}>
      <label htmlFor={id} className={hideLabel ? "visually-hidden" : "field-label"}>
        {label}
      </label>
      <input id={id} type="text" value={value} onChange={(event) => onChange(event.target.value)} />
    </span>
  );
};

/** Grows with its text, so an instruction reads whole without a scrollbar. */
export const TextArea = ({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
}) => {
  const id = useId();
  return (
    <span className="text-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea id={id} rows={2} value={value} onChange={(event) => onChange(event.target.value)} />
      {hint && <span className="field-hint">{hint}</span>}
    </span>
  );
};
