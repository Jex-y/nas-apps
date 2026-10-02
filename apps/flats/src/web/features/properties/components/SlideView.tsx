import { LOCATION_ZOOM, LocationMap } from "../../map/components/LocationMap";
import type { Slide } from "../utils/slides";

/**
 * The slide at `index`, with a photo after it mounted but hidden so it has loaded by the time it is shown: photo URLs
 * redirect to freshly signed ones, so a separately preloaded copy would never be a cache hit.
 */
export const SlideView = ({
  slides,
  index,
  zoom = LOCATION_ZOOM,
  interactive,
}: {
  slides: readonly Slide[];
  index: number;
  zoom?: number;
  interactive: boolean;
}) =>
  slides
    .slice(index, index + 2)
    .map((slide, ahead) =>
      slide.kind === "map" ? (
        ahead === 0 && (
          <LocationMap
            key="map"
            latitude={slide.latitude}
            longitude={slide.longitude}
            zoom={zoom}
            interactive={interactive}
          />
        )
      ) : (
        <img
          key={slide.url}
          src={slide.url}
          alt=""
          draggable={false}
          className={ahead === 0 ? slide.kind : `${slide.kind} preload`}
        />
      ),
    );
