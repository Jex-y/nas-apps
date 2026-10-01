import { useEffect, useState } from "react";
import { formatElapsed } from "../../../utils/format";

/** Past this a rest is over in all but name, and the clock would only distract. */
const STALE_MS = 15 * 60_000;

/** Time since the last set was logged, ticking. Keeps its place when it has nothing to show, so nothing moves. */
export const RestTimer = ({ since }: { readonly since: string | null }) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = since === null ? null : now - Date.parse(since);
  return (
    <p className="rest" role="timer" aria-label="Rest">
      {elapsed !== null && elapsed <= STALE_MS && (
        <>
          <span className="label">Rest</span>
          <span className="numeric">{formatElapsed(elapsed)}</span>
        </>
      )}
    </p>
  );
};
