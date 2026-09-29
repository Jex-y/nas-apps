import { requestEmpty, requestJson } from "@nas/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ProjectList, ProjectView, type SaveProject, TASKS_API } from "../../../../contract";

export const projectKeys = {
  list: ["projects"] as const,
  detail: (id: string) => ["projects", id] as const,
};

export const useProjects = () =>
  useQuery({ queryKey: projectKeys.list, queryFn: () => requestJson(`${TASKS_API}/projects`, ProjectList) });

export const useProject = (id: string) =>
  useQuery({
    queryKey: projectKeys.detail(id),
    queryFn: () => requestJson(`${TASKS_API}/projects/${id}`, ProjectView),
    refetchInterval: 60_000,
  });

/** Every change answers with the project as it now is, so the screen updates without another round trip. */
export const useProjectChange = <T>(mutationFn: (input: T) => Promise<ProjectView>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (view) => {
      queryClient.setQueryData(projectKeys.detail(view.id), view);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
    },
  });
};

export const sendJson = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

export const useCreateProject = () =>
  useProjectChange((input: SaveProject) => requestJson(`${TASKS_API}/projects`, ProjectView, sendJson("POST", input)));

export const useRenameProject = (id: string) =>
  useProjectChange((input: SaveProject) =>
    requestJson(`${TASKS_API}/projects/${id}`, ProjectView, sendJson("PATCH", input)),
  );

export const useDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => requestEmpty(`${TASKS_API}/projects/${id}`, { method: "DELETE" }),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: projectKeys.detail(id) });
      return queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
    },
  });
};
