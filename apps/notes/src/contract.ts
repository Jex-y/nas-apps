import { z } from "zod";

export const NOTES_API = "/notes/api";

export const Note = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Note = z.infer<typeof Note>;

export const NoteList = z.array(Note);

export const CreateNote = z.object({
  body: z.string().trim().min(1).max(10_000),
});
export type CreateNote = z.infer<typeof CreateNote>;
