import { useEffect, useState } from "react";
import type { z } from "zod";

type Props = {
  readonly value: number;
  /** What the cell may hold; anything else typed into it is put back as it was. */
  readonly schema: z.ZodType<number>;
  readonly label: string;
  readonly inputMode: "decimal" | "numeric";
  /** Called on leaving the cell, and only when it holds something new. */
  readonly onCommit: (value: number) => void;
};

/** A figure in a table, typed over in place and taken once the cell is left, so half-typed figures are never saved. */
export const NumberCell = ({ value, schema, label, inputMode, onCommit }: Props) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const typed = schema.safeParse(Number(draft.trim().replace(",", ".")));
    if (draft.trim() === "" || !typed.success) {
      setDraft(String(value));
    } else if (typed.data !== value) {
      onCommit(typed.data);
    }
  };

  return (
    <input
      className="numeric"
      inputMode={inputMode}
      enterKeyHint="done"
      value={draft}
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
