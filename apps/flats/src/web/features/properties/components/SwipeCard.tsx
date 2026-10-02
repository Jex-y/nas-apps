import { Link } from "wouter";
import type { PropertySummary } from "../../../../contract";
import { Warnings } from "../../../components/PropertyCard";
import { formatDate, formatPrice, keyFacts } from "../../../utils/format";
import type { SwipeGesture } from "../hooks/useSwipeGesture";
import { coverSlides, type Slide } from "../utils/slides";
import { SlideView } from "./SlideView";

/** The map is a picture here, so that a drag across it still swipes the card. */
const Gallery = ({ slides, index }: { slides: readonly Slide[]; index: number }) => {
  const current = slides[index];
  if (current === undefined) {
    return <div className="no-photo" />;
  }
  return (
    <>
      <SlideView slides={slides} index={index} interactive={false} />
      {slides.length > 1 && (
        <ol className="photo-bars" aria-label={`Photo ${index + 1} of ${slides.length}`}>
          {slides.map((slide, i) => (
            <li key={slide.kind === "map" ? "map" : slide.url} className={i === index ? "current" : undefined} />
          ))}
        </ol>
      )}
      {current.kind === "floorplan" && <span className="photo-label">Floorplan</span>}
    </>
  );
};

export const SwipeCard = ({
  property,
  slides = coverSlides(property),
  slideIndex = 0,
  gesture,
}: {
  property: PropertySummary;
  slides?: readonly Slide[] | undefined;
  slideIndex?: number;
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
      <Gallery slides={slides} index={slideIndex} />
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
