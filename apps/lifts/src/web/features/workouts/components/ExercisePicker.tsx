import { type FormEvent, useState } from "react";
import type { Exercise } from "../../../../contract";
import { useExerciseActions } from "../../exercises/api/exercises";
import { LIFT_NAMES, missingLifts } from "../../exercises/utils/lifts";

type Props = {
  readonly exercises: readonly Exercise[];
  readonly onPick: (exerciseId: string) => void;
};

/** Finds an exercise by name as it is typed, or makes one of that name. */
export const ExercisePicker = ({ exercises, onPick }: Props) => {
  const create = useExerciseActions().create;
  const [query, setQuery] = useState("");

  const wanted = query.trim().toLowerCase();
  const matches = exercises.filter((exercise) => exercise.name.toLowerCase().includes(wanted));
  const exact = exercises.some((exercise) => exercise.name.toLowerCase() === wanted);
  const pick = (exerciseId: string) => {
    setQuery("");
    onPick(exerciseId);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const [only] = matches;
    if (wanted !== "" && !exact) {
      pick(create(query.trim()));
    } else if (only !== undefined && matches.length === 1) {
      pick(only.id);
    }
  };

  return (
    <form className="card picker" onSubmit={submit}>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Add an exercise"
        aria-label="Exercise name"
        maxLength={100}
      />
      <ul className="choices">
        {matches.map((exercise) => (
          <li key={exercise.id}>
            <button type="button" onClick={() => pick(exercise.id)}>
              {exercise.name}
            </button>
          </li>
        ))}
        {wanted === "" &&
          missingLifts(exercises).map((lift) => (
            <li key={lift}>
              <button type="button" onClick={() => pick(create(LIFT_NAMES[lift], lift))}>
                + {LIFT_NAMES[lift]}
              </button>
            </li>
          ))}
        {wanted !== "" && !exact && (
          <li>
            <button type="submit">Create “{query.trim()}”</button>
          </li>
        )}
      </ul>
    </form>
  );
};
