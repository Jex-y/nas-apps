import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreateNote, NOTES_API, Note, NoteList } from "../../../../contract";

const notesKey = ["notes"] as const;

export const useNotes = () =>
  useQuery({
    queryKey: notesKey,
    queryFn: () => requestJson(`${NOTES_API}/notes`, NoteList),
  });

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNote) =>
      requestJson(`${NOTES_API}/notes`, Note, { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestEmpty(`${NOTES_API}/notes/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: notesKey }),
  });
};
