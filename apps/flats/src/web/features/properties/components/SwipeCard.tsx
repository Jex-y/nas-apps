import { Link } from "wouter";
import type { PropertySummary } from "../../../../contract";
import { Warnings } from "../../../components/PropertyCard";
import { formatDate, formatPrice, keyFacts } from "../../../utils/format";
import type { SwipeGesture } from "../hooks/useSwipeGesture";

export const SwipeCard = ({ property, gesture }: { property: PropertySummary; gesture?: SwipeGesture }) => (
  <article
    ref={gesture?.ref}
    className={["swipe-card", gesture && "top", gesture?.transform && "dragging"].filter(Boolean).join(" ")}
    style={{ transform: gesture?.transform }}
    aria-hidden={gesture === undefined}
    {...gesture?.handlers}
  >
    <div className="swipe-photo">
      {property.thumbnailUrl ? (
        <img src={property.thumbnailUrl} alt="" draggable={false} />
      ) : (
        <div className="no-photo" />
      )}
      <span className="stamp shortlist" style={{ opacity: Math.max(0, gesture?.lean ?? 0) }}>
        Shortlist
      </span>
      <span className="stamp reject" style={{ opacity: Math.max(0, -(gesture?.lean ?? 0)) }}>
        Nope
      </span>
    </div>
    <div className="swipe-body">
      <div className="card-heading">
        <h2>{formatPrice(property.price, property.priceQualifier)}</h2>
        <span className="muted">{formatDate(property.firstSeenAt)}</span>
      </div>
      <p className="address">
        {property.address}
        {property.postcode && <span className="muted"> · {property.postcode}</span>}
      </p>
      <p className="facts">{[property.propertyType, ...keyFacts(property)].filter(Boolean).join(" · ")}</p>
      <Warnings property={property} />
      {property.commutes.length > 0 && (
        <ul className="commutes">
          {property.commutes.map((commute) => (
            <li key={commute.destinationId}>
              {commute.name} <strong>{commute.minutes === null ? "no route" : `${commute.minutes} min`}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="links">
        <Link href={`/properties/${property.id}`}>Details</Link>
        {property.listings.map((listing) => (
          <a key={listing.url} href={listing.url} target="_blank" rel="noreferrer">
            {listing.portal}
          </a>
        ))}
      </p>
    </div>
  </article>
);
