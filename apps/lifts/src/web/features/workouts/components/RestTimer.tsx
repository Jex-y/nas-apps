import { useEffect, useState } from "react";
import { formatElapsed } from "../../../utils/format";

/** Past this a rest is over in all but name, and the clock would only distract. */
const STALE_MS = 15 * 60_000;

/** Time since the last set was logged, ticking. */
export const RestTimer = ({ since }: { readonly since: string }) => {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - Date.parse(since);
  return elapsed > STALE_MS ? null : (
    <p className="rest" role="timer" aria-label="Rest">
      <span className="label">Rest</span>
      <span className="numeric">{formatElapsed(elapsed)}</span>
    </p>
  );
};
