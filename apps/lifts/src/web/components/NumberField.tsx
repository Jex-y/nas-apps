import { useEffect, useState } from "react";
import type { z } from "zod";

type Props<S extends z.ZodType<number>> = {
  readonly value: number | null;
  /** What the field may hold; anything else typed into it is put back as it was. */
  readonly schema: S;
  readonly label: string;
  readonly inputMode: "decimal" | "numeric";
  readonly placeholder?: string;
  /** Called on leaving the field, and only when it holds something new. `null` is a field left empty. */
  readonly onCommit: (value: number | null) => void;
};

const text = (value: number | null) => (value === null ? "" : String(value));

/** A number typed freely and taken only once the field is left, so half-typed figures are never saved. */
export const NumberField = <S extends z.ZodType<number>>({
  value,
  schema,
  label,
  inputMode,
  placeholder,
  onCommit,
}: Props<S>) => {
  const [draft, setDraft] = useState(text(value));

  useEffect(() => {
    setDraft(text(value));
  }, [value]);

  const commit = () => {
    const typed = draft.trim().replace(",", ".");
    const parsed = typed === "" ? null : schema.safeParse(Number(typed));
    if (parsed !== null && !parsed.success) {
      setDraft(text(value));
      return;
    }
    const next = parsed === null ? null : parsed.data;
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <input
      className="numeric"
      inputMode={inputMode}
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
};
