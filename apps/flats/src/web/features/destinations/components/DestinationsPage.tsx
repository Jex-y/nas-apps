import { type FormEvent, useState } from "react";
import { useCreateDestination, useDeleteDestination, useDestinations } from "../api/destinations";

const DestinationForm = () => {
  const createDestination = useCreateDestination();
  const [name, setName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [arriveBy, setArriveBy] = useState("09:00");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createDestination.mutate(
      { name, postcode, arriveBy },
      {
        onSuccess: () => {
          setName("");
          setPostcode("");
        },
      },
    );
  };

  return (
    <form className="destination-form" onSubmit={submit}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name, e.g. Office" required />
      <input
        value={postcode}
        onChange={(event) => setPostcode(event.target.value)}
        placeholder="Postcode"
        aria-label="Postcode"
        required
      />
      <label>
        Arrive by <input type="time" value={arriveBy} onChange={(event) => setArriveBy(event.target.value)} required />
      </label>
      <button type="submit" disabled={createDestination.isPending}>
        Add place
      </button>
      {createDestination.error && <p className="error">{createDestination.error.message}</p>}
    </form>
  );
};

export const DestinationsPage = () => {
  const destinations = useDestinations();
  const remove = useDeleteDestination();

  return (
    <section>
      <h1>Commutes</h1>
      <p className="muted">
        Each property still in play is timed by public transport to every place here, arriving by its time on a Tuesday.
        A new place takes a few minutes to reach every property.
      </p>
      <DestinationForm />
      {destinations.error && <p className="error">{destinations.error.message}</p>}
      <ul className="destinations">
        {destinations.data?.map((destination) => (
          <li key={destination.id}>
            <div>
              <strong>{destination.name}</strong>{" "}
              <span className="muted">
                {destination.postcode} · by {destination.arriveBy}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => remove.mutate(destination.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
