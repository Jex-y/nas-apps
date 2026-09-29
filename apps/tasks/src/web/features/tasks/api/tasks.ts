import { requestJson } from "@nas/core/web";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type CreateTask,
  type MoveTask,
  ProjectView,
  STATUSES,
  TASKS_API,
  type UpdateTask,
} from "../../../../contract";
import { projectKeys, sendJson, useProjectChange } from "../../projects/api/projects";

type Move = MoveTask & { readonly taskId: string };
type Edge = { readonly taskId: string; readonly dependsOnId: string };

export const useCreateTask = (projectId: string) =>
  useProjectChange((input: CreateTask) =>
    requestJson(`${TASKS_API}/projects/${projectId}/tasks`, ProjectView, sendJson("POST", input)),
  );

export const useUpdateTask = () =>
  useProjectChange(({ taskId, update }: { taskId: string; update: UpdateTask }) =>
    requestJson(`${TASKS_API}/tasks/${taskId}`, ProjectView, sendJson("PATCH", update)),
  );

export const useDeleteTask = () =>
  useProjectChange((taskId: string) => requestJson(`${TASKS_API}/tasks/${taskId}`, ProjectView, sendJson("DELETE")));

const dependencyPath = ({ taskId, dependsOnId }: Edge) => `${TASKS_API}/tasks/${taskId}/dependencies/${dependsOnId}`;

export const useAddDependency = () =>
  useProjectChange((edge: Edge) => requestJson(dependencyPath(edge), ProjectView, sendJson("PUT")));

export const useRemoveDependency = () =>
  useProjectChange((edge: Edge) => requestJson(dependencyPath(edge), ProjectView, sendJson("DELETE")));

/** The move as the server will make it, on a project whose tasks are in board order. */
export const moveLocally = (view: ProjectView, { taskId, status, beforeId }: Move): ProjectView => {
  const task = view.tasks.find((other) => other.id === taskId);
  if (task === undefined) {
    return view;
  }
  const rest = view.tasks.filter((other) => other.id !== taskId);
  const column = STATUSES.indexOf(status);
  const at =
    beforeId === null
      ? rest.findLastIndex((other) => STATUSES.indexOf(other.status) <= column) + 1
      : rest.findIndex((other) => other.id === beforeId);
  return { ...view, tasks: rest.toSpliced(at, 0, { ...task, status }) };
};

/** Moves the card at once, putting it back if the server refuses. */
export const useMoveTask = (projectId: string) => {
  const queryClient = useQueryClient();
  const key = projectKeys.detail(projectId);
  return useMutation({
    mutationFn: ({ taskId, ...move }: Move) =>
      requestJson(`${TASKS_API}/tasks/${taskId}/move`, ProjectView, sendJson("PUT", move)),
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<ProjectView>(key);
      if (before !== undefined) {
        queryClient.setQueryData(key, moveLocally(before, move));
      }
      return { before };
    },
    onError: (_, __, context) => queryClient.setQueryData(key, context?.before),
    onSuccess: (view) => {
      queryClient.setQueryData(key, view);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list, exact: true });
    },
  });
};
