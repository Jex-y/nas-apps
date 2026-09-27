import { z } from "zod";

export const NOTES_API = "/notes/api";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export const Attachment = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
});
export type Attachment = z.infer<typeof Attachment>;

export const Note = z.object({
  id: z.uuid(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  attachments: z.array(Attachment),
});
export type Note = z.infer<typeof Note>;

export const NoteList = z.array(Note);

export const CreateNote = z.object({
  body: z.string().trim().min(1).max(10_000),
});
export type CreateNote = z.infer<typeof CreateNote>;

/** Redirects to a short-lived download URL, so it works as a plain link. */
export const attachmentDownloadPath = (attachmentId: string): string => `${NOTES_API}/attachments/${attachmentId}`;
