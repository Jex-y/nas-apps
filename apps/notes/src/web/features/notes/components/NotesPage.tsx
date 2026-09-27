import { type FormEvent, useState } from "react";
import { useCreateNote, useDeleteNote, useNotes } from "../api/notes";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export const NotesPage = () => {
  const notes = useNotes();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();
  const [draft, setDraft] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createNote.mutate({ body: draft }, { onSuccess: () => setDraft("") });
  };

  return (
    <main>
      <h1>Notes</h1>
      <form onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a note…"
          rows={3}
          required
        />
        {createNote.error && <p className="muted">{createNote.error.message}</p>}
        <button type="submit" disabled={createNote.isPending}>
          Add note
        </button>
      </form>

      {notes.isPending && <p className="muted">Loading…</p>}
      {notes.error && <p className="muted">{notes.error.message}</p>}
      {notes.data?.length === 0 && <p className="muted">No notes yet.</p>}
      <ul>
        {notes.data?.map((note) => (
          <li key={note.id}>
            <div>
              <p>{note.body}</p>
              <time dateTime={note.createdAt}>{dateFormat.format(new Date(note.createdAt))}</time>
            </div>
            <button type="button" onClick={() => deleteNote.mutate(note.id)} disabled={deleteNote.isPending}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
};
