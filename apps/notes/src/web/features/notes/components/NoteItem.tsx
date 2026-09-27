import { useState } from "react";
import { type Attachment, attachmentDownloadPath, MAX_ATTACHMENT_BYTES, type Note } from "../../../../contract";
import { useDeleteAttachment, useDeleteNote, useUploadAttachment } from "../api/notes";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const formatSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const AttachmentRow = ({ attachment }: { readonly attachment: Attachment }) => {
  const deleteAttachment = useDeleteAttachment();
  return (
    <li className="attachment">
      <a href={attachmentDownloadPath(attachment.id)}>{attachment.filename}</a>
      <span className="muted">{formatSize(attachment.size)}</span>
      <button
        type="button"
        className="link"
        onClick={() => deleteAttachment.mutate(attachment.id)}
        disabled={deleteAttachment.isPending}
      >
        Remove
      </button>
    </li>
  );
};

export const NoteItem = ({ note }: { readonly note: Note }) => {
  const deleteNote = useDeleteNote();
  const upload = useUploadAttachment();
  const [tooLarge, setTooLarge] = useState(false);

  const attach = (file: File) => {
    setTooLarge(file.size > MAX_ATTACHMENT_BYTES);
    if (file.size <= MAX_ATTACHMENT_BYTES) {
      upload.mutate({ noteId: note.id, file });
    }
  };

  return (
    <li className="note">
      <div className="note-body">
        <p>{note.body}</p>
        <time dateTime={note.createdAt}>{dateFormat.format(new Date(note.createdAt))}</time>
        {note.attachments.length > 0 && (
          <ul className="attachments">
            {note.attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} attachment={attachment} />
            ))}
          </ul>
        )}
        {tooLarge && <p className="muted">Attachments are limited to {formatSize(MAX_ATTACHMENT_BYTES)}.</p>}
        {upload.error && <p className="muted">{upload.error.message}</p>}
      </div>
      <div className="note-actions">
        <label className="button">
          {upload.isPending ? "Uploading…" : "Attach"}
          <input
            type="file"
            hidden
            disabled={upload.isPending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file !== undefined) {
                attach(file);
              }
            }}
          />
        </label>
        <button type="button" onClick={() => deleteNote.mutate(note.id)} disabled={deleteNote.isPending}>
          Delete
        </button>
      </div>
    </li>
  );
};
