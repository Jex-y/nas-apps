import { Link } from "wouter";
import type { Photo, PropertySummary } from "../../../../contract";
import { Warnings } from "../../../components/PropertyCard";
import { formatDate, formatPrice, keyFacts } from "../../../utils/format";
import type { SwipeGesture } from "../hooks/useSwipeGesture";

export type GalleryPhoto = Pick<Photo, "kind" | "url">;

/**
 * The current photo, with the next one mounted but hidden so it has loaded by the time it is shown: photo URLs
 * redirect to freshly signed ones, so a separately preloaded copy would never be a cache hit.
 */
const Gallery = ({ photos, index }: { photos: readonly GalleryPhoto[]; index: number }) => {
  const current = photos[index];
  if (current === undefined) {
    return <div className="no-photo" />;
  }
  return (
    <>
      {photos.slice(index, index + 2).map((photo) => (
        <img
          key={photo.url}
          src={photo.url}
          alt=""
          draggable={false}
          className={[photo.kind, photo !== current && "preload"].filter(Boolean).join(" ")}
        />
      ))}
      {photos.length > 1 && (
        <ol className="photo-bars" aria-label={`Photo ${index + 1} of ${photos.length}`}>
          {photos.map((photo, i) => (
            <li key={photo.url} className={i === index ? "current" : undefined} />
          ))}
        </ol>
      )}
      {current.kind === "floorplan" && <span className="photo-label">Floorplan</span>}
    </>
  );
};

export const SwipeCard = ({
  property,
  photos = property.thumbnailUrl ? [{ kind: "photo", url: property.thumbnailUrl }] : [],
  photoIndex = 0,
  gesture,
}: {
  property: PropertySummary;
  photos?: readonly GalleryPhoto[] | undefined;
  photoIndex?: number;
  gesture?: SwipeGesture;
}) => (
  <article
    ref={gesture?.ref}
    className={["swipe-card", gesture && "top", gesture?.transform && "dragging"].filter(Boolean).join(" ")}
    style={{ transform: gesture?.transform }}
    aria-hidden={gesture === undefined}
    {...gesture?.handlers}
  >
    <div className="swipe-photo">
      <Gallery photos={photos} index={photoIndex} />
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
