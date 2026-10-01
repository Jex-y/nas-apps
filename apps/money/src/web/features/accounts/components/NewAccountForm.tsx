import { type FormEvent, useState } from "react";
import { KINDS, type Kind } from "../../../../contract";
import { KIND_LABELS } from "../../../utils/format";
import { useCreateAccount } from "../api/accounts";

export const NewAccountForm = () => {
  const create = useCreateAccount();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("property");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ name, kind }, { onSuccess: () => setName("") });
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="A flat, a pension, a loan…"
        aria-label="Account name"
        maxLength={100}
        required
      />
      <select value={kind} onChange={(event) => setKind(event.target.value as Kind)} aria-label="Kind">
        {KINDS.map((option) => (
          <option key={option} value={option}>
            {KIND_LABELS[option]}
          </option>
        ))}
      </select>
      <button type="submit" disabled={create.isPending}>
        Add
      </button>
      {create.error && <span className="error">{create.error.message}</span>}
    </form>
  );
};
