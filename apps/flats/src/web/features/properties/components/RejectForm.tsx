import { type FormEvent, useEffect, useRef, useState } from "react";

export const RejectForm = ({ onReject, onCancel }: { onReject: (reason: string) => void; onCancel: () => void }) => {
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onReject(reason);
  };

  return (
    <form className="reject-form" onSubmit={submit}>
      <input
        ref={input}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
        placeholder="Why not? e.g. ground floor, tiny kitchen"
        aria-label="Reason for rejecting"
        required
      />
      <button type="submit">Reject</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
};
