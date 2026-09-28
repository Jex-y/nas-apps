import { useEffect, useState } from "react";
import type { PropertyDetail } from "../../../../contract";
import { Warnings } from "../../../components/PropertyCard";
import {
  AVAILABILITY_LABELS,
  formatCommuteTime,
  formatDate,
  formatMoney,
  formatPrice,
  formatTenure,
  pricePerSqft,
} from "../../../utils/format";
import { useProperty, useUpdateNotes } from "../api/properties";
import { StatusControl } from "./StatusControl";
import { ViewingsSection } from "./ViewingsSection";

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
  const detail = property.data;
  const [cover, ...rest] = detail.photos.filter((photo) => photo.kind === "photo");
  const floorplans = detail.photos.filter((photo) => photo.kind === "floorplan");

  return (
    <article className="property">
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

      <div className="gallery">
        {cover ? (
          <img className="cover" src={cover.url} alt="" />
        ) : (
          detail.thumbnailUrl && <img className="cover" src={detail.thumbnailUrl} alt="" />
        )}
        <div className="thumbs">
          {[...rest, ...floorplans].map((photo) => (
            <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
              <img src={photo.url} alt={photo.kind} loading="lazy" />
            </a>
          ))}
        </div>
      </div>

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
