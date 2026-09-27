import { TRACKED_STATUSES } from "../../../../contract";
import { PropertyCard } from "../../../components/PropertyCard";
import { STATUS_LABELS } from "../../../utils/format";
import { useProperties } from "../api/properties";
import { StatusControl } from "./StatusControl";

export const BoardPage = () => {
  const properties = useProperties("all");

  if (properties.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (properties.error) {
    return <p className="error">{properties.error.message}</p>;
  }

  return (
    <section>
      <h1>Board</h1>
      <div className="board">
        {TRACKED_STATUSES.map((status) => {
          const column = properties.data.filter((property) => property.status === status);
          return (
            <div key={status} className="column">
              <h2>
                {STATUS_LABELS[status]} <span className="muted">{column.length}</span>
              </h2>
              {column.map((property) => (
                <PropertyCard key={property.id} property={property} actions={<StatusControl property={property} />} />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
};
