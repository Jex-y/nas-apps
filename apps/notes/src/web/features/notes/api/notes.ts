import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Attachment, type CreateNote, NOTES_API, Note, NoteList } from "../../../../contract";

const notesKey = ["notes"] as const;

const useInvalidatingMutation = <TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  });
};

export const useNotes = () =>
  useQuery({
    queryKey: notesKey,
    queryFn: () => requestJson(`${NOTES_API}/notes`, NoteList),
  });

export const useCreateNote = () =>
  useInvalidatingMutation((input: CreateNote) =>
    requestJson(`${NOTES_API}/notes`, Note, { method: "POST", body: JSON.stringify(input) }),
  );

export const useDeleteNote = () =>
  useInvalidatingMutation((noteId: string) => requestEmpty(`${NOTES_API}/notes/${noteId}`, { method: "DELETE" }));

export const useUploadAttachment = () =>
  useInvalidatingMutation(({ noteId, file }: { readonly noteId: string; readonly file: File }) => {
    const body = new FormData();
    body.set("file", file);
    return requestJson(`${NOTES_API}/notes/${noteId}/attachments`, Attachment, { method: "POST", body });
  });

export const useDeleteAttachment = () =>
  useInvalidatingMutation((attachmentId: string) =>
    requestEmpty(`${NOTES_API}/attachments/${attachmentId}`, { method: "DELETE" }),
  );
