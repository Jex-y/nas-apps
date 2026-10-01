import { useState } from "react";
import { Link } from "wouter";
import { loadView } from "../../../lib/view";
import { formatDistance } from "../../../utils/format";
import { type Start, useSuggestions } from "../api/suggestions";

export const SuggestPage = () => {
  const [start, setStart] = useState<Start | null>(null);
  const [locating, setLocating] = useState<string | null>(null);
  const suggestions = useSuggestions(start);

  const fromHere = () => {
    setLocating("Finding you…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(null);
        setStart({ lat: coords.latitude, lon: coords.longitude });
      },
      (error) => setLocating(`Could not find you: ${error.message}`),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const fromMap = () => {
    const { lat, lon } = loadView();
    setStart({ lat, lon });
  };

  return (
    <section>
      <h1>Where next</h1>
      <p className="muted">
        Clusters of streets you have not finished within 3 km, ranked by how many there are for the distance to reach
        them.
      </p>
      <div className="card-actions">
        <button type="button" className="primary" onClick={fromHere}>
          From here
        </button>
        <button type="button" onClick={fromMap}>
          From the map's centre
        </button>
      </div>
      {locating && <p className="muted">{locating}</p>}
      {suggestions.error && <p className="error">{suggestions.error.message}</p>}
      {suggestions.data?.length === 0 && <p className="muted">Nothing unfinished nearby. Impressive.</p>}
      <ol className="suggestions">
        {suggestions.data?.map((suggestion) => (
          <li key={`${suggestion.lat},${suggestion.lon}`}>
            <div className="card-heading">
              <strong>
                {suggestion.streets.length} street{suggestion.streets.length === 1 ? "" : "s"}
              </strong>
              <span className="figure muted">{formatDistance(suggestion.distanceMetres)} away</span>
            </div>
            <p className="street-names">
              {suggestion.streets.map((street) => street.name).join(" · ")}
            </p>
            <Link href={`/?at=${suggestion.lat.toFixed(5)},${suggestion.lon.toFixed(5)}`} className="button">
              Show on map
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
};
