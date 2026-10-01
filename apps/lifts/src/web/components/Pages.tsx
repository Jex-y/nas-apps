import { useMemo } from "react";
import { Route, Switch } from "wouter";
import { workoutDetails } from "../../log";
import { ExercisePage } from "../features/exercises/components/ExercisePage";
import { ExercisesPage } from "../features/exercises/components/ExercisesPage";
import { HistoryPage } from "../features/workouts/components/HistoryPage";
import { LogPage } from "../features/workouts/components/LogPage";
import { WorkoutPage } from "../features/workouts/components/WorkoutPage";
import { useLog } from "../hooks/useLog";

/** Every view shows the same log, so it is read once here and handed down. */
export const Pages = () => {
  const log = useLog();
  const workouts = useMemo(() => workoutDetails(log), [log]);

  return (
    <Switch>
      <Route path="/">
        <LogPage exercises={log.exercises} workouts={workouts} />
      </Route>
      <Route path="/history">
        <HistoryPage workouts={workouts} />
      </Route>
      <Route path="/workouts/:workoutId">
        {({ workoutId }) => (
          <WorkoutPage key={workoutId} exercises={log.exercises} workouts={workouts} workoutId={workoutId} />
        )}
      </Route>
      <Route path="/exercises">
        <ExercisesPage exercises={log.exercises} workouts={workouts} />
      </Route>
      <Route path="/exercises/:exerciseId">
        {({ exerciseId }) => (
          <ExercisePage key={exerciseId} exercises={log.exercises} workouts={workouts} exerciseId={exerciseId} />
        )}
      </Route>
      <Route>
        <p className="muted">Nothing here.</p>
      </Route>
    </Switch>
  );
};
