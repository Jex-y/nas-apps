import { PropertyCard } from "../../../components/PropertyCard";
import { useProperties } from "../api/properties";
import { StatusControl } from "./StatusControl";

export const RejectedPage = () => {
  const properties = useProperties("rejected");

  if (properties.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (properties.error) {
    return <p className="error">{properties.error.message}</p>;
  }

  return (
    <section>
      <h1>Rejected</h1>
      <div className="cards">
        {properties.data.map((property) => (
          <PropertyCard key={property.id} property={property} actions={<StatusControl property={property} />} />
        ))}
      </div>
    </section>
  );
};
