import { type FormEvent, useState } from "react";
import { useCreateNote, useNotes } from "../api/notes";
import { NoteItem } from "./NoteItem";

export const NotesPage = () => {
  const notes = useNotes();
  const createNote = useCreateNote();
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
      <ul className="notes">
        {notes.data?.map((note) => (
          <NoteItem key={note.id} note={note} />
        ))}
      </ul>
    </main>
  );
};
