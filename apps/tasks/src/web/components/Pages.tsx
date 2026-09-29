import { Route, Switch } from "wouter";
import { BoardPage } from "../features/board/components/BoardPage";
import { useTasks } from "../features/tasks/api/tasks";
import { ListPage } from "../features/tasks/components/ListPage";
import { TaskPage } from "../features/tasks/components/TaskPage";
import { TimelinePage } from "../features/timeline/components/TimelinePage";

/** Every view shows the same list, so it is loaded once here and handed down. */
export const Pages = () => {
  const tasks = useTasks();

  if (tasks.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (tasks.error) {
    return <p className="error">{tasks.error.message}</p>;
  }
  return (
    <Switch>
      <Route path="/">
        <ListPage tasks={tasks.data} />
      </Route>
      <Route path="/board">
        <BoardPage tasks={tasks.data} />
      </Route>
      <Route path="/timeline">
        <TimelinePage tasks={tasks.data} />
      </Route>
      <Route path="/task/:taskId">{({ taskId }) => <TaskPage key={taskId} tasks={tasks.data} taskId={taskId} />}</Route>
      <Route>
        <p className="muted">Nothing here.</p>
      </Route>
    </Switch>
  );
};
