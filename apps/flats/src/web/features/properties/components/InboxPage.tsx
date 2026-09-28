import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { PropertyCard } from "../../../components/PropertyCard";
import { useProperties, useUpdateStatus } from "../api/properties";
import { isTyping } from "../utils/keyboard";
import { RejectForm } from "./RejectForm";

/** New listings to triage: j/k to move, s to shortlist, x to reject, r to reject with a reason, o to open. */
export const InboxPage = () => {
  const properties = useProperties("new");
  const updateStatus = useUpdateStatus();
  const [, navigate] = useLocation();
  const [cursor, setCursor] = useState(0);
  const [rejecting, setRejecting] = useState<string | null>(null);

  const items = properties.data ?? [];
  const selected = items[Math.min(cursor, items.length - 1)];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || rejecting !== null || selected === undefined) {
        return;
      }
      const actions: Record<string, () => void> = {
        j: () => setCursor((index) => Math.min(index + 1, items.length - 1)),
        k: () => setCursor((index) => Math.max(index - 1, 0)),
        s: () => updateStatus.mutate({ id: selected.id, update: { status: "shortlisted" } }),
        x: () => updateStatus.mutate({ id: selected.id, update: { status: "rejected", reason: null } }),
        r: () => setRejecting(selected.id),
        o: () => navigate(`/properties/${selected.id}`),
      };
      const action = actions[event.key];
      if (action !== undefined) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length, navigate, rejecting, selected, updateStatus]);

  useEffect(() => {
    document.querySelector(".card.selected")?.scrollIntoView({ block: "nearest" });
  });

  if (properties.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (properties.error) {
    return <p className="error">{properties.error.message}</p>;
  }

  return (
    <section>
      <div className="page-heading">
        <h1>Inbox</h1>
        <span className="muted">
          {items.length} new · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>s</kbd> shortlist · <kbd>x</kbd> reject ·{" "}
          <kbd>r</kbd> with reason · <kbd>o</kbd> open
        </span>
      </div>
      {items.length === 0 && <p className="muted">Nothing new. Searches are polled every ten minutes.</p>}
      <div className="cards">
        {items.map((property) => (
          <PropertyCard
            key={property.id}
            property={property}
            selected={property.id === selected?.id}
            actions={
              rejecting === property.id ? (
                <RejectForm
                  onCancel={() => setRejecting(null)}
                  onReject={(reason) =>
                    updateStatus.mutate(
                      { id: property.id, update: { status: "rejected", reason } },
                      { onSuccess: () => setRejecting(null) },
                    )
                  }
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => updateStatus.mutate({ id: property.id, update: { status: "shortlisted" } })}
                  >
                    Shortlist
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateStatus.mutate({ id: property.id, update: { status: "rejected", reason: null } })
                    }
                  >
                    Reject
                  </button>
                  <button type="button" onClick={() => setRejecting(property.id)}>
                    Reject with reason…
                  </button>
                </>
              )
            }
          />
        ))}
      </div>
    </section>
  );
};
