import { describe, expect, test } from "bun:test";
import { createBlobStore, parseBlobConfig } from "@nas/core";
import { startTestServer, uniqueLogin } from "@nas/core/testing";
import { Attachment, attachmentDownloadPath, Note, NoteList } from "../contract";
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

describe("attachments", () => {
  const blobs = createBlobStore(parseBlobConfig(process.env), "notes");

  const upload = (as: string, noteId: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return request(`/notes/api/notes/${noteId}/attachments`, { as, method: "POST", body });
  };

  const attach = async (as: string, noteId: string, file: File): Promise<Attachment> => {
    const response = await upload(as, noteId, file);
    expect(response.status).toBe(201);
    return Attachment.parse(await response.json());
  };

  test("an uploaded file is listed on its note and downloads through a presigned redirect", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "with a file");

    const attachment = await attach(alice, note.id, new File(["hello blob"], "hello.txt", { type: "text/plain" }));

    const [listed] = await listNotes(alice);
    expect(listed?.attachments).toEqual([attachment]);
    expect(attachment).toMatchObject({
      filename: "hello.txt",
      contentType: expect.stringMatching(/^text\/plain/),
      size: 10,
    });

    const redirect = await request(attachmentDownloadPath(attachment.id), { as: alice });
    expect(redirect.status).toBe(302);
    const download = await fetch(redirect.headers.get("Location") ?? "");
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello blob");
    expect(download.headers.get("Content-Disposition")).toContain("hello.txt");
  });

  test("cannot attach to or download from someone else's note", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "private");
    const attachment = await attach(alice, note.id, new File(["secret"], "secret.txt"));

    const intruder = uniqueLogin();
    expect((await upload(intruder, note.id, new File(["x"], "x.txt"))).status).toBe(404);
    expect((await request(attachmentDownloadPath(attachment.id), { as: intruder })).status).toBe(404);
  });

  test("rejects an empty upload", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "empty");
    expect((await upload(alice, note.id, new File([], "empty.txt"))).status).toBe(400);
  });

  test("removing an attachment deletes its blob", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "remove one");
    const attachment = await attach(alice, note.id, new File(["bye"], "bye.txt"));

    const response = await request(attachmentDownloadPath(attachment.id), { as: alice, method: "DELETE" });

    expect(response.status).toBe(204);
    expect(await blobs.exists(attachment.id)).toBe(false);
    expect((await listNotes(alice))[0]?.attachments).toEqual([]);
  });

  test("deleting a note deletes its attachments' blobs", async () => {
    const alice = uniqueLogin();
    const note = await createNote(alice, "remove all");
    const first = await attach(alice, note.id, new File(["1"], "1.txt"));
    const second = await attach(alice, note.id, new File(["2"], "2.txt"));

    await request(`/notes/api/notes/${note.id}`, { as: alice, method: "DELETE" });

    expect(await blobs.exists(first.id)).toBe(false);
    expect(await blobs.exists(second.id)).toBe(false);
  });
});
