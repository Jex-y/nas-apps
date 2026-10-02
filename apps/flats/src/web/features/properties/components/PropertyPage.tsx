import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { PropertyDetail } from "../../../../contract";
import { Contributions } from "../../../components/Contributions";
import { Warnings } from "../../../components/PropertyCard";
import { useKeymap } from "../../../hooks/useKeymap";
import {
  AVAILABILITY_LABELS,
  formatCommuteTime,
  formatDate,
  formatMoney,
  formatPrice,
  formatTenure,
  pricePerSqft,
} from "../../../utils/format";
import { SCROLL_BINDINGS } from "../../../utils/keymap";
import { useProperty, useUpdateNotes, useUpdateStatus } from "../api/properties";
import { openOnPortal } from "../utils/portal";
import { firstOf, type Slide, slidesOf } from "../utils/slides";
import { CrimeSection } from "./CrimeSection";
import { PhotoViewer } from "./PhotoViewer";
import { StatusControl } from "./StatusControl";
import { ViewingsSection } from "./ViewingsSection";

/**
 * An installed app has no browser back button. Goes back through the app's history, or to the inbox when the page was
 * opened directly, e.g. from a notification.
 */
const useGoBack = () => {
  const [, navigate] = useLocation();
  return () => (window.history.length > 1 ? window.history.back() : navigate("/"));
};

const BackLink = () => (
  <button type="button" className="back-link" onClick={useGoBack()}>
    ‹ Back
  </button>
);

const Facts = ({ property }: { property: PropertyDetail }) => {
  const rows: [string, string | null][] = [
    ["Type", property.propertyType || null],
    ["Bedrooms", property.bedrooms?.toString() ?? null],
    ["Bathrooms", property.bathrooms?.toString() ?? null],
    ["Size", property.sizeSqft === null ? null : `${property.sizeSqft.toLocaleString("en-GB")} sq ft`],
    ["Price per sq ft", pricePerSqft(property)],
    ["Tenure", formatTenure(property)],
    [
      "Service charge",
      property.annualServiceCharge === null ? null : `${formatMoney(property.annualServiceCharge)} a year`,
    ],
    ["Ground rent", property.annualGroundRent === null ? null : `${formatMoney(property.annualGroundRent)} a year`],
    ["Council tax", property.councilTaxBand === null ? null : `Band ${property.councilTaxBand}`],
    ["Agent", property.agent === null ? null : [property.agent.name, property.agent.phone].filter(Boolean).join(" · ")],
  ];
  return (
    <dl className="facts-table">
      {rows
        .filter((row): row is [string, string] => row[1] !== null)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
};

/** The cover and a strip of the rest, the map last; l, f and m open them full screen. */
const PhotoGallery = ({ property }: { property: PropertyDetail }) => {
  const [viewing, setViewing] = useState<number | null>(null);
  const slides = slidesOf(property);
  const show = (kind: Slide["kind"]) => () => setViewing(firstOf(slides, kind) ?? 0);
  useKeymap(
    "Photos",
    slides.length === 0
      ? []
      : [
          { keys: ["l", "Space"], does: "Look through the photos", run: show("photo") },
          { keys: ["f"], does: "Floorplan", run: show("floorplan") },
          { keys: ["m"], does: "Where it is on the map", run: show("map") },
        ],
  );

  const cover = slides[0]?.kind === "map" ? undefined : slides[0];

  return (
    <div className="gallery">
      {cover && (
        <button type="button" onClick={() => setViewing(0)}>
          <img className="cover" src={cover.url} alt="" />
        </button>
      )}
      <div className="thumbs">
        {slides.map((slide, at) =>
          slide === cover ? null : slide.kind === "map" ? (
            <button key="map" type="button" className="map-thumb" onClick={() => setViewing(at)}>
              Map
            </button>
          ) : (
            <button key={slide.url} type="button" onClick={() => setViewing(at)}>
              <img src={slide.url} alt={slide.kind} loading="lazy" />
            </button>
          ),
        )}
      </div>
      {viewing !== null && (
        <PhotoViewer slides={slides} index={viewing} onStep={setViewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
};

/** What the flat sold for before, newest first, and how far the asking price has come since the last sale. */
const SalesSection = ({ price, sales }: Pick<PropertyDetail, "price" | "sales">) => {
  const [last] = sales;
  const above = price === null || last === undefined ? null : Math.round((price / last.price - 1) * 100);
  return (
    <section>
      <h2>Sold before</h2>
      <ol className="history">
        {sales.map((sale) => (
          <li key={`${sale.year} ${sale.price}`}>
            <span className="muted">{sale.year}</span> {formatMoney(sale.price)}
          </li>
        ))}
      </ol>
      {above !== null && (
        <p className="muted">
          Asking {Math.abs(above)}% {above >= 0 ? "above" : "below"} the {last?.year} sale.
        </p>
      )}
    </section>
  );
};

const Notes = ({ property }: { property: PropertyDetail }) => {
  const updateNotes = useUpdateNotes();
  const [notes, setNotes] = useState(property.notes);
  useEffect(() => setNotes(property.notes), [property.notes]);

  return (
    <section>
      <h2>Notes</h2>
      <textarea
        value={notes}
        rows={4}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => notes !== property.notes && updateNotes.mutate({ id: property.id, notes })}
        placeholder="Anything worth remembering"
      />
      {updateNotes.isPending && <span className="muted">Saving…</span>}
      {updateNotes.error && <p className="error">{updateNotes.error.message}</p>}
    </section>
  );
};

export const PropertyPage = ({ id }: { id: string }) => {
  const property = useProperty(id);

  if (property.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (property.error) {
    return <p className="error">{property.error.message}</p>;
  }
  return <Property detail={property.data} />;
};

const Property = ({ detail }: { detail: PropertyDetail }) => {
  const updateStatus = useUpdateStatus();
  const goBack = useGoBack();
  useKeymap("Listing", [
    {
      keys: ["s"],
      does: "Shortlist",
      run: () => updateStatus.mutate({ id: detail.id, update: { status: "shortlisted" } }),
    },
    {
      keys: ["x"],
      does: "Reject",
      run: () => updateStatus.mutate({ id: detail.id, update: { status: "rejected", reason: null } }),
    },
    { keys: ["g x"], does: "Open on the portal", run: () => openOnPortal(detail) },
    { keys: ["q", "Backspace"], does: "Back", run: goBack },
    ...SCROLL_BINDINGS,
  ]);

  return (
    <article className="property">
      <BackLink />
      <div className="page-heading">
        <div>
          <h1>{formatPrice(detail.price, detail.priceQualifier)}</h1>
          <p className="address">
            {detail.address}
            {detail.postcode && <span className="muted"> · {detail.postcode}</span>}
          </p>
          <Warnings property={detail} />
        </div>
        <div className="status-box">
          <StatusControl property={detail} />
          {detail.status === "rejected" && detail.rejectedReason && <p className="muted">{detail.rejectedReason}</p>}
          <p className="links">
            {detail.listings.map((listing) => (
              <a key={listing.url} href={listing.url} target="_blank" rel="noreferrer">
                View on {listing.portal}
              </a>
            ))}
          </p>
        </div>
      </div>

      <PhotoGallery property={detail} />

      <div className="columns">
        <div>
          <Facts property={detail} />
          {detail.keyFeatures.length > 0 && (
            <ul className="features">
              {detail.keyFeatures.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          )}
          <p className="prose">{detail.description}</p>
        </div>
        <aside>
          <Notes property={detail} />
          {detail.commutes.length > 0 && (
            <section>
              <h2>Commutes</h2>
              <ul className="commutes">
                {detail.commutes.map((commute) => (
                  <li key={commute.destinationId}>
                    {commute.name} <span className="muted">{formatCommuteTime(commute.minutes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {detail.crime !== null && <CrimeSection crime={detail.crime} />}
          {detail.ranking.kind === "scored" && detail.ranking.contributions.length > 0 && (
            <Contributions total={detail.ranking.total} contributions={detail.ranking.contributions} />
          )}
          {detail.sales.length > 0 && <SalesSection price={detail.price} sales={detail.sales} />}
          <section>
            <h2>History</h2>
            <ol className="history">
              {detail.history.map((point) => (
                <li key={point.observedAt}>
                  <span className="muted">{formatDate(point.observedAt)}</span> {formatPrice(point.price)}
                  {AVAILABILITY_LABELS[point.availability] && ` · ${AVAILABILITY_LABELS[point.availability]}`}
                </li>
              ))}
            </ol>
          </section>
          {detail.nearestStations.length > 0 && (
            <section>
              <h2>Stations</h2>
              <ul className="stations">
                {detail.nearestStations.map((station) => (
                  <li key={station.name}>
                    {station.name} <span className="muted">{station.miles.toFixed(1)} mi</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <ViewingsSection propertyId={detail.id} viewings={detail.viewings} />
    </article>
  );
};
