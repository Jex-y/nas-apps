import {
  type AppContext,
  createBlobStore,
  defineRoutes,
  HttpError,
  parseBody,
  parseParam,
  resolveViewer,
} from "@nas/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { type Attachment, CreateNote, MAX_ATTACHMENT_BYTES, type Note } from "../contract";
import { attachments, notes } from "./schema";

type AttachmentRow = typeof attachments.$inferSelect;

const toAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType,
  size: row.size,
});

const toNote = (row: typeof notes.$inferSelect, noteAttachments: readonly AttachmentRow[]): Note => ({
  id: row.id,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  attachments: noteAttachments.map(toAttachment),
});

const parseUpload = async (request: Request): Promise<File> => {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Request body must be multipart/form-data");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new HttpError(400, "Expected a non-empty `file` field");
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new HttpError(413, `Attachments are limited to ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  }
  return file;
};

export const createNotesRoutes = ({ sql, blob, identity }: AppContext) => {
  const db = drizzle({ client: sql });
  const blobs = createBlobStore(blob, "notes");

  const ownedNote = async (id: string, owner: string) => {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.owner, owner)));
    if (!note) {
      throw new HttpError(404, "Not found");
    }
    return note;
  };

  const ownedAttachment = async (id: string, owner: string): Promise<AttachmentRow> => {
    const [row] = await db
      .select({ attachment: attachments })
      .from(attachments)
      .innerJoin(notes, eq(attachments.noteId, notes.id))
      .where(and(eq(attachments.id, id), eq(notes.owner, owner)));
    if (!row) {
      throw new HttpError(404, "Not found");
    }
    return row.attachment;
  };

  /** Rows go first: a blob without a row is garbage, a row without a blob is a broken download. */
  const deleteBlobs = (rows: readonly Pick<AttachmentRow, "id">[]) =>
    Promise.all(rows.map((row) => blobs.delete(row.id)));

  return defineRoutes({
    "/notes/api/notes": {
      GET: async (request) => {
        const viewer = resolveViewer(identity, request);
        const noteRows = await db
          .select()
          .from(notes)
          .where(eq(notes.owner, viewer.login))
          .orderBy(desc(notes.createdAt));
        const attachmentRows =
          noteRows.length === 0
            ? []
            : await db
                .select()
                .from(attachments)
                .where(
                  inArray(
                    attachments.noteId,
                    noteRows.map((note) => note.id),
                  ),
                )
                .orderBy(attachments.createdAt);
        return Response.json(
          noteRows.map((note) =>
            toNote(
              note,
              attachmentRows.filter((attachment) => attachment.noteId === note.id),
            ),
          ),
        );
      },
      POST: async (request) => {
        const viewer = resolveViewer(identity, request);
        const input = await parseBody(request, CreateNote);
        const [row] = await db.insert(notes).values({ owner: viewer.login, body: input.body }).returning();
        if (!row) {
          throw new Error("INSERT … RETURNING produced no row");
        }
        return Response.json(toNote(row, []), { status: 201 });
      },
    },
    "/notes/api/notes/:id": {
      DELETE: async (request) => {
        const viewer = resolveViewer(identity, request);
        const note = await ownedNote(parseParam(request.params.id, z.uuid()), viewer.login);
        const doomed = await db.select({ id: attachments.id }).from(attachments).where(eq(attachments.noteId, note.id));
        await db.delete(notes).where(eq(notes.id, note.id));
        await deleteBlobs(doomed);
        return new Response(null, { status: 204 });
      },
    },
    "/notes/api/notes/:id/attachments": {
      POST: async (request) => {
        const viewer = resolveViewer(identity, request);
        const note = await ownedNote(parseParam(request.params.id, z.uuid()), viewer.login);
        const file = await parseUpload(request);
        const id = crypto.randomUUID();
        const contentType = file.type || "application/octet-stream";

        await blobs.write(id, file, contentType);
        const [row] = await db
          .insert(attachments)
          .values({
            id,
            noteId: note.id,
            filename: file.name,
            contentType,
            size: file.size,
          })
          .returning()
          .catch(async (error: unknown) => {
            await blobs.delete(id);
            throw error;
          });
        if (!row) {
          throw new Error("INSERT … RETURNING produced no row");
        }
        return Response.json(toAttachment(row), { status: 201 });
      },
    },
    "/notes/api/attachments/:id": {
      GET: async (request) => {
        const viewer = resolveViewer(identity, request);
        const attachment = await ownedAttachment(parseParam(request.params.id, z.uuid()), viewer.login);
        return Response.redirect(blobs.downloadUrl(attachment.id, { filename: attachment.filename }), 302);
      },
      DELETE: async (request) => {
        const viewer = resolveViewer(identity, request);
        const attachment = await ownedAttachment(parseParam(request.params.id, z.uuid()), viewer.login);
        await db.delete(attachments).where(eq(attachments.id, attachment.id));
        await deleteBlobs([attachment]);
        return new Response(null, { status: 204 });
      },
    },
    "/notes/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
