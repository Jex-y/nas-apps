import type { ReactNode } from "react";
import { Link } from "wouter";
import type { PropertySummary } from "../../contract";
import { AVAILABILITY_LABELS, formatCommutes, formatDate, formatPoints, formatPrice, keyFacts } from "../utils/format";

export const Warnings = ({ property }: { property: PropertySummary }) => {
  const flagged = [
    AVAILABILITY_LABELS[property.availability],
    property.sharedOwnership ? "Shared ownership" : null,
    property.auction ? "Auction" : null,
    property.leaseYearsRemaining !== null && property.leaseYearsRemaining < 90 ? "Short lease" : null,
    property.ranking.kind === "excluded" ? property.ranking.reason : null,
  ].filter((warning): warning is string => warning !== null);
  // Jev and the portal can both flag an auction.
  const warnings = [...new Set(flagged)];
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
        <span className="muted">
          {property.ranking.kind === "scored" && (
            <span className="score" title="Score">
              {formatPoints(property.ranking.total)}
            </span>
          )}{" "}
          {formatDate(property.firstSeenAt)}
        </span>
      </div>
      <p className="address">
        {property.address}
        {property.postcode && <span className="muted"> · {property.postcode}</span>}
      </p>
      <p className="facts">{keyFacts(property).join(" · ")}</p>
      {property.commutes.length > 0 && <p className="facts">{formatCommutes(property.commutes)}</p>}
      <Warnings property={property} />
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  </article>
);
