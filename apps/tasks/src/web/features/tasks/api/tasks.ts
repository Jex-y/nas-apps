import { requestJson } from "@apps/core/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CreateTask, type MoveTask, STATUSES, TASKS_API, TaskList, type UpdateTask } from "../../../../contract";

type Move = MoveTask & { readonly taskId: string };
type Edge = { readonly taskId: string; readonly dependsOnId: string };

export const tasksKey = ["tasks"] as const;

export const useTasks = () =>
  useQuery({
    queryKey: tasksKey,
    queryFn: () => requestJson(`${TASKS_API}/tasks`, TaskList),
    refetchInterval: 60_000,
  });

const sendJson = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body !== undefined && { body: JSON.stringify(body) }),
});

/** Every change answers with the list as it now is, so the screen updates without another round trip. */
const useTasksChange = <T>(mutationFn: (input: T) => Promise<TaskList>) => {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn, onSuccess: (list) => queryClient.setQueryData(tasksKey, list) });
};

export const useCreateTask = () =>
  useTasksChange((input: CreateTask) => requestJson(`${TASKS_API}/tasks`, TaskList, sendJson("POST", input)));

export const useUpdateTask = () =>
  useTasksChange(({ taskId, update }: { taskId: string; update: UpdateTask }) =>
    requestJson(`${TASKS_API}/tasks/${taskId}`, TaskList, sendJson("PATCH", update)),
  );

export const useDeleteTask = () =>
  useTasksChange((taskId: string) => requestJson(`${TASKS_API}/tasks/${taskId}`, TaskList, sendJson("DELETE")));

const dependencyPath = ({ taskId, dependsOnId }: Edge) => `${TASKS_API}/tasks/${taskId}/dependencies/${dependsOnId}`;

export const useAddDependency = () =>
  useTasksChange((edge: Edge) => requestJson(dependencyPath(edge), TaskList, sendJson("PUT")));

export const useRemoveDependency = () =>
  useTasksChange((edge: Edge) => requestJson(dependencyPath(edge), TaskList, sendJson("DELETE")));

/** The move as the server will make it, on a list in board order. */
export const moveLocally = (list: TaskList, { taskId, status, beforeId }: Move): TaskList => {
  const task = list.find((other) => other.id === taskId);
  if (task === undefined) {
    return list;
  }
  const rest = list.filter((other) => other.id !== taskId);
  const column = STATUSES.indexOf(status);
  const at =
    beforeId === null
      ? rest.findLastIndex((other) => STATUSES.indexOf(other.status) <= column) + 1
      : rest.findIndex((other) => other.id === beforeId);
  return rest.toSpliced(at, 0, { ...task, status });
};

/** Moves the card at once, putting it back if the server refuses. */
export const useMoveTask = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, ...move }: Move) =>
      requestJson(`${TASKS_API}/tasks/${taskId}/move`, TaskList, sendJson("PUT", move)),
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: tasksKey });
      const before = queryClient.getQueryData<TaskList>(tasksKey);
      if (before !== undefined) {
        queryClient.setQueryData(tasksKey, moveLocally(before, move));
      }
      return { before };
    },
    onError: (_, __, context) => queryClient.setQueryData(tasksKey, context?.before),
    onSuccess: (list) => queryClient.setQueryData(tasksKey, list),
  });
};
