import { type FormEvent, useState } from "react";
import { MAX_VIEWING_PHOTO_BYTES, type Viewing } from "../../../../contract";
import { formatDateTime } from "../../../utils/format";
import { useAddViewing, useDeleteViewing, useUploadViewingPhoto } from "../api/properties";

const localNow = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const ViewingForm = ({ propertyId }: { propertyId: string }) => {
  const addViewing = useAddViewing();
  const [at, setAt] = useState(localNow);
  const [rating, setRating] = useState("");
  const [notes, setNotes] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    addViewing.mutate(
      {
        id: propertyId,
        viewing: { at: new Date(at).toISOString(), rating: rating === "" ? null : Number(rating), notes },
      },
      { onSuccess: () => setNotes("") },
    );
  };

  return (
    <form className="viewing-form" onSubmit={submit}>
      <label>
        When
        <input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} required />
      </label>
      <label>
        Rating
        <select value={rating} onChange={(event) => setRating(event.target.value)}>
          <option value="">—</option>
          {[1, 2, 3, 4, 5].map((stars) => (
            <option key={stars} value={stars}>
              {"★".repeat(stars)}
            </option>
          ))}
        </select>
      </label>
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="How was it?" rows={3} />
      {addViewing.error && <p className="error">{addViewing.error.message}</p>}
      <button type="submit" disabled={addViewing.isPending}>
        Add viewing
      </button>
    </form>
  );
};

const ViewingItem = ({ viewing }: { viewing: Viewing }) => {
  const deleteViewing = useDeleteViewing();
  const upload = useUploadViewingPhoto();

  return (
    <li className="viewing">
      <div className="viewing-heading">
        <strong>{formatDateTime(viewing.at)}</strong>
        {viewing.rating !== null && <span>{"★".repeat(viewing.rating)}</span>}
        <span className="muted">{viewing.createdBy}</span>
        <button type="button" onClick={() => deleteViewing.mutate(viewing.id)} disabled={deleteViewing.isPending}>
          Delete
        </button>
      </div>
      {viewing.notes && <p className="prose">{viewing.notes}</p>}
      <div className="thumbs">
        {viewing.photos.map((photo) => (
          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
            <img src={photo.url} alt={photo.filename} loading="lazy" />
          </a>
        ))}
      </div>
      <label className="upload">
        {upload.isPending ? "Uploading…" : "Add photos"}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            for (const file of Array.from(event.target.files ?? [])) {
              if (file.size <= MAX_VIEWING_PHOTO_BYTES) {
                upload.mutate({ viewingId: viewing.id, file });
              }
            }
            event.target.value = "";
          }}
        />
      </label>
      {upload.error && <p className="error">{upload.error.message}</p>}
    </li>
  );
};

export const ViewingsSection = ({ propertyId, viewings }: { propertyId: string; viewings: readonly Viewing[] }) => (
  <section>
    <h2>Viewings</h2>
    <ViewingForm propertyId={propertyId} />
    <ul className="viewings">
      {viewings.map((viewing) => (
        <ViewingItem key={viewing.id} viewing={viewing} />
      ))}
    </ul>
  </section>
);
