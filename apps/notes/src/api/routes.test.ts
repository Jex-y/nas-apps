import { describe, expect, test } from "bun:test";
import { startTestServer, uniqueLogin } from "@nas/core/testing";
import { Note, NoteList } from "../contract";
import { createNotesApp } from "../module";

const request = startTestServer((context) => [createNotesApp(context)]);

const createNote = async (as: string, body: string): Promise<Note> => {
  const response = await request("/notes/api/notes", { as, method: "POST", body: JSON.stringify({ body }) });
  expect(response.status).toBe(201);
  return Note.parse(await response.json());
};

const listNotes = async (as: string): Promise<readonly Note[]> => {
  const response = await request("/notes/api/notes", { as });
  expect(response.status).toBe(200);
  return NoteList.parse(await response.json());
};

describe("notes api", () => {
  test("rejects requests without a Tailscale identity", async () => {
    const response = await request("/notes/api/notes");
    expect(response.status).toBe(401);
  });

  test("lists only the viewer's notes, newest first", async () => {
    const alice = uniqueLogin();
    const bob = uniqueLogin();
    await createNote(alice, "first");
    await createNote(alice, "second");
    await createNote(bob, "bob's");

    expect((await listNotes(alice)).map((note) => note.body)).toEqual(["second", "first"]);
    expect((await listNotes(bob)).map((note) => note.body)).toEqual(["bob's"]);
  });

  test("rejects a blank note", async () => {
    const response = await request("/notes/api/notes", {
      as: uniqueLogin(),
      method: "POST",
      body: JSON.stringify({ body: "   " }),
    });
    expect(response.status).toBe(400);
  });

  test("deletes the viewer's own note", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "doomed");

    const response = await request(`/notes/api/notes/${note.id}`, { as: alice, method: "DELETE" });

    expect(response.status).toBe(204);
    expect(await listNotes(alice)).toEqual([]);
  });

  test("cannot delete someone else's note", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "mine");

    const response = await request(`/notes/api/notes/${note.id}`, { as: uniqueLogin(), method: "DELETE" });

    expect(response.status).toBe(404);
    expect(await listNotes(alice)).toHaveLength(1);
  });

  test("unknown api paths are 404s, not the app page", async () => {
    const response = await request("/notes/api/nope", { as: uniqueLogin() });
    expect(response.status).toBe(404);
  });
});
