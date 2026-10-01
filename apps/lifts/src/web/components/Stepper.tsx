import { useEffect, useState } from "react";
import type { z } from "zod";
import { Icon } from "./Icon";

type Props = {
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly step: number;
  /** What the value may be; a typed figure outside it is put back, and the buttons stop at its edges. */
  readonly schema: z.ZodType<number>;
  readonly inputMode: "decimal" | "numeric";
  readonly onChange: (value: number) => void;
};

/** A figure nudged by thumb or typed outright. Typing is taken on leaving the field. */
export const Stepper = ({ label, unit, value, step, schema, inputMode, onChange }: Props) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const nudge = (by: number) => {
    const next = schema.safeParse(Math.round((value + by) * 100) / 100);
    if (next.success) {
      onChange(next.data);
    }
  };
  const commit = () => {
    const typed = schema.safeParse(Number(draft.trim().replace(",", ".")));
    if (draft.trim() !== "" && typed.success) {
      onChange(typed.data);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="stepper">
      <span className="label">{label}</span>
      <div className="stepper-controls">
        <button type="button" aria-label={`Less ${label.toLowerCase()}`} onClick={() => nudge(-step)}>
          <Icon name="minus" />
        </button>
        <input
          className="numeric"
          inputMode={inputMode}
          value={draft}
          aria-label={`${label} in ${unit}`}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="button" aria-label={`More ${label.toLowerCase()}`} onClick={() => nudge(step)}>
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
};
