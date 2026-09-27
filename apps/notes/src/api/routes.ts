import { type AppContext, defineRoutes, HttpError, parseBody, parseParam, resolveViewer } from "@nas/core";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { z } from "zod";
import { CreateNote, type Note } from "../contract";
import { notes } from "./schema";

const toNote = (row: typeof notes.$inferSelect): Note => ({
  id: row.id,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

export const createNotesRoutes = ({ sql, identity }: AppContext) => {
  const db = drizzle({ client: sql });

  return defineRoutes({
    "/notes/api/notes": {
      GET: async (request) => {
        const viewer = resolveViewer(identity, request);
        const rows = await db.select().from(notes).where(eq(notes.owner, viewer.login)).orderBy(desc(notes.createdAt));
        return Response.json(rows.map(toNote));
      },
      POST: async (request) => {
        const viewer = resolveViewer(identity, request);
        const input = await parseBody(request, CreateNote);
        const [row] = await db.insert(notes).values({ owner: viewer.login, body: input.body }).returning();
        if (!row) {
          throw new Error("INSERT … RETURNING produced no row");
        }
        return Response.json(toNote(row), { status: 201 });
      },
    },
    "/notes/api/notes/:id": {
      DELETE: async (request) => {
        const viewer = resolveViewer(identity, request);
        const id = parseParam(request.params.id, z.uuid());
        const deleted = await db
          .delete(notes)
          .where(and(eq(notes.id, id), eq(notes.owner, viewer.login)))
          .returning({ id: notes.id });
        if (deleted.length === 0) {
          throw new HttpError(404, "Not found");
        }
        return new Response(null, { status: 204 });
      },
    },
    "/notes/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  });
};
