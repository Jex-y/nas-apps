import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { PropertySummary } from "../../../../contract";
import { PropertyCard } from "../../../components/PropertyCard";
import { useKeymap } from "../../../hooks/useKeymap";
import { formatPoints, formatPrice, keyFacts } from "../../../utils/format";
import type { Binding } from "../../../utils/keymap";
import { useInbox, useSlides } from "../api/properties";
import { useTriageHistory } from "../hooks/useTriageHistory";
import { openOnPortal } from "../utils/portal";
import { coverSlides, firstOf, type Slide } from "../utils/slides";
import { PhotoViewer } from "./PhotoViewer";
import { RejectForm } from "./RejectForm";

/** How far ctrl+d and ctrl+u move. */
const LEAP = 5;

/** `index` is where the cursor sits; a property to `follow` holds it instead, wherever the list puts it. */
type Cursor = { readonly index: number; readonly follow: string | null };

/**
 * New listings to triage from the keyboard: j/k to move, s to shortlist, x to reject, u to undo, o to open, and l to
 * look through the selected one's photos full screen, where the same keys keep working.
 */
export const InboxPage = () => {
  const properties = useInbox();
  const triage = useTriageHistory();
  const [, navigate] = useLocation();
  const [cursor, setCursor] = useState<Cursor>({ index: 0, follow: null });
  const [rejecting, setRejecting] = useState<string | null>(null);
  // Keyed by property, so moving to another listing starts from its first photo without an effect to reset it.
  const [viewer, setViewer] = useState<{ readonly propertyId: string; readonly index: number } | null>(null);

  const items = properties.data ?? [];
  const followed = items.findIndex((property) => property.id === cursor.follow);
  const index = followed === -1 ? Math.max(0, Math.min(cursor.index, items.length - 1)) : followed;
  const selected = items[index];
  const moveTo = (to: number) => setCursor({ index: Math.max(0, Math.min(to, items.length - 1)), follow: null });

  const slides = useSlides(selected?.id).data ?? (selected === undefined ? [] : coverSlides(selected));
  // Fetched ahead so the next listing's photos are there as soon as it is.
  useSlides(items[index + 1]?.id);
  const slideIndex = viewer?.propertyId === selected?.id ? (viewer?.index ?? 0) : 0;

  const on = (run: (property: PropertySummary) => void) => () => {
    if (selected !== undefined) {
      run(selected);
    }
  };
  const show = (kind: Slide["kind"]) =>
    on((property) => setViewer({ propertyId: property.id, index: firstOf(slides, kind) ?? 0 }));

  const listing: readonly Binding[] = [
    { keys: ["j", "ArrowDown"], does: "Next listing", run: () => moveTo(index + 1) },
    { keys: ["k", "ArrowUp"], does: "Previous listing", run: () => moveTo(index - 1) },
    { keys: ["ctrl+d"], does: "Five listings down", run: () => moveTo(index + LEAP) },
    { keys: ["ctrl+u"], does: "Five listings up", run: () => moveTo(index - LEAP) },
    { keys: ["g g"], does: "First listing", run: () => moveTo(0) },
    { keys: ["G"], does: "Last listing", run: () => moveTo(items.length - 1) },
    { keys: ["s"], does: "Shortlist", run: on((property) => triage.decide(property, { status: "shortlisted" })) },
    {
      keys: ["x"],
      does: "Reject",
      run: on((property) => triage.decide(property, { status: "rejected", reason: null })),
    },
    {
      keys: ["r"],
      does: "Reject with a reason",
      run: on((property) => {
        setViewer(null);
        setRejecting(property.id);
      }),
    },
    {
      keys: ["u"],
      does: "Undo",
      run: () => setCursor({ index, follow: triage.undo()?.id ?? null }),
    },
    { keys: ["o", "Enter"], does: "Open the details", run: on((property) => navigate(`/properties/${property.id}`)) },
    { keys: ["g x"], does: "Open on the portal", run: on(openOnPortal) },
  ];
  useKeymap(
    "Inbox",
    rejecting !== null
      ? []
      : [
          ...listing,
          { keys: ["l", "Space"], does: "Look through the photos", run: show("photo") },
          { keys: ["f"], does: "Floorplan", run: show("floorplan") },
          { keys: ["m"], does: "Where it is on the map", run: show("map") },
        ],
  );

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
          {items.length} new
          <span className="key-hints">
            {" "}
            · <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>s</kbd> shortlist · <kbd>x</kbd> reject · <kbd>u</kbd> undo ·{" "}
            <kbd>l</kbd> photos · <kbd>m</kbd> map · <kbd>?</kbd> all keys
          </span>
        </span>
      </div>
      {items.length === 0 && <p className="muted">Nothing new. Searches are polled every ten minutes.</p>}
      {triage.error && <p className="error">{triage.error.message}</p>}
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
                  onReject={(reason) => {
                    triage.decide(property, { status: "rejected", reason });
                    setRejecting(null);
                  }}
                />
              ) : (
                <>
                  <button type="button" onClick={() => triage.decide(property, { status: "shortlisted" })}>
                    Shortlist
                  </button>
                  <button type="button" onClick={() => triage.decide(property, { status: "rejected", reason: null })}>
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
      {viewer !== null && selected !== undefined && (
        <PhotoViewer
          slides={slides}
          index={slideIndex}
          onStep={(to) => setViewer({ propertyId: selected.id, index: to })}
          onClose={() => setViewer(null)}
          bindings={listing}
        >
          <p>
            <strong>{formatPrice(selected.price, selected.priceQualifier)}</strong> {selected.address}
            {selected.ranking.kind === "scored" && (
              <span className="score"> {formatPoints(selected.ranking.total)}</span>
            )}
          </p>
          <p>{keyFacts(selected).join(" · ")}</p>
          <p className="key-hints">
            {index + 1} of {items.length} · <kbd>j</kbd>/<kbd>k</kbd> listings · <kbd>h</kbd>/<kbd>l</kbd> photos ·{" "}
            <kbd>s</kbd> shortlist · <kbd>x</kbd> reject · <kbd>u</kbd> undo · <kbd>m</kbd> map · <kbd>q</kbd> close
          </p>
        </PhotoViewer>
      )}
    </section>
  );
};
