import { Link } from "wouter";
import { formatSynced, isStale } from "../../../utils/format";
import { usePet } from "../api/pet";
import { HatchPanel } from "./HatchPanel";
import { PetPanel } from "./PetPanel";

const HealthStatus = ({ lastHealthAt }: { lastHealthAt: string | null }) => {
  if (lastHealthAt === null) {
    return (
      <p className="notice">
        No steps have arrived yet. <Link href="/health">Connect Apple Health</Link>
      </p>
    );
  }
  if (isStale(lastHealthAt)) {
    return (
      <p className="notice">
        No steps since {formatSynced(lastHealthAt)}; the Shortcut may have stopped. <Link href="/health">Check it</Link>
      </p>
    );
  }
  return <p className="muted synced">Steps synced {formatSynced(lastHealthAt)}</p>;
};

export const HomePage = () => {
  const view = usePet();

  if (view.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (view.error) {
    return <p className="error">{view.error.message}</p>;
  }
  const { pet, today, lastHealthAt } = view.data;
  return (
    <>
      {pet === null ? <HatchPanel /> : <PetPanel pet={pet} today={today} />}
      <HealthStatus lastHealthAt={lastHealthAt} />
    </>
  );
};
