import { Link } from "wouter";
import type { MapProperty } from "../../../../contract";
import { formatMoney, formatPoints, pricePerSqft } from "../../../utils/format";

/** The listing picked on the map, with what sets it apart and a way through to it. */
export const SelectedCard = ({ property, onClose }: { property: MapProperty; onClose: () => void }) => {
  return (
    <article className="map-card" aria-label={property.address}>
      {property.thumbnailUrl && <img className="map-card-photo" src={property.thumbnailUrl} alt="" />}
      <div className="map-card-body">
        <div className="map-card-heading">
          <span className="map-card-price">
            {property.priceQualifier && <small>{property.priceQualifier}</small>}
            <strong>{formatMoney(property.price) ?? "POA"}</strong>
          </span>
          {property.ranking.kind === "scored" ? (
            <span className="map-card-score">{formatPoints(property.ranking.total)}</span>
          ) : (
            <span className="map-card-out">{property.ranking.reason}</span>
          )}
        </div>
        <p className="map-card-address">{property.address}</p>
        <p className="map-card-facts">
          {[
            property.bedrooms === null ? null : `${property.bedrooms} bed`,
            property.sizeSqft === null ? null : `${property.sizeSqft.toLocaleString("en-GB")} sq ft`,
            pricePerSqft(property),
            property.crime === null ? null : `${Math.round(property.crime.perMonth)} crimes a month nearby`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <Link href={`/properties/${property.id}`} className="map-card-link">
          Open the listing
        </Link>
      </div>
      <button type="button" className="icon-button map-card-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </article>
  );
};
