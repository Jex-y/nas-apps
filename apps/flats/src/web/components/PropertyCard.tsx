import type { ReactNode } from "react";
import { Link } from "wouter";
import type { PropertySummary } from "../../contract";
import { AVAILABILITY_LABELS, formatDate, formatPrice, keyFacts } from "../utils/format";

export const Warnings = ({ property }: { property: PropertySummary }) => {
  const warnings = [
    AVAILABILITY_LABELS[property.availability],
    property.sharedOwnership ? "Shared ownership" : null,
    property.auction ? "Auction" : null,
    property.leaseYearsRemaining !== null && property.leaseYearsRemaining < 90 ? "Short lease" : null,
  ].filter((warning): warning is string => warning !== null);
  return warnings.length === 0 ? null : (
    <ul className="badges">
      {warnings.map((warning) => (
        <li key={warning} className="badge warning">
          {warning}
        </li>
      ))}
    </ul>
  );
};

export const PropertyCard = ({
  property,
  selected = false,
  actions,
}: {
  property: PropertySummary;
  selected?: boolean;
  actions?: ReactNode;
}) => (
  <article className={selected ? "card selected" : "card"} aria-current={selected}>
    <Link href={`/properties/${property.id}`} className="card-photo">
      {property.thumbnailUrl ? <img src={property.thumbnailUrl} alt="" loading="lazy" /> : <div className="no-photo" />}
    </Link>
    <div className="card-body">
      <div className="card-heading">
        <Link href={`/properties/${property.id}`}>
          <h2>{formatPrice(property.price, property.priceQualifier)}</h2>
        </Link>
        <span className="muted">{formatDate(property.firstSeenAt)}</span>
      </div>
      <p className="address">
        {property.address}
        {property.postcode && <span className="muted"> · {property.postcode}</span>}
      </p>
      <p className="facts">{keyFacts(property).join(" · ")}</p>
      <Warnings property={property} />
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  </article>
);
