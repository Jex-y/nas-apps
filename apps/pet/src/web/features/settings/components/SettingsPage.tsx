import { type FormEvent, useState } from "react";
import { ACCESSORIES, type Accessory, type PetState, StepGoal, type Today, UNLOCK_STREAKS } from "../../../../contract";
import { capitalised } from "../../../utils/format";
import { usePet, useUpdatePet } from "../../pet/api/pet";

const accessoryName = (accessory: Accessory) => capitalised(accessory.replace("_", " "));

const SettingsForm = ({ pet, today }: { pet: PetState; today: Today }) => {
  const update = useUpdatePet();
  const [name, setName] = useState(pet.name);
  const [goal, setGoal] = useState(String(today.goal));
  const goalValid = StepGoal.safeParse(Number(goal)).success;

  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ name, stepGoal: Number(goal) });
  };

  return (
    <>
      <form className="settings-form" onSubmit={save}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} required />
        </label>
        <label>
          Daily step goal
          <input
            type="number"
            inputMode="numeric"
            min={1_000}
            max={50_000}
            step={500}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            required
          />
        </label>
        <p className="muted">
          A new goal counts from today; the days already walked keep the goal they had. Between 1,000 and 50,000.
        </p>
        <button type="submit" disabled={update.isPending || !goalValid}>
          Save
        </button>
        {update.isSuccess && <span className="muted">Saved.</span>}
      </form>

      <h2>Accessories</h2>
      <div className="accessories">
        {ACCESSORIES.map((accessory) => {
          const unlocked = pet.unlocked.includes(accessory);
          const worn = pet.accessory === accessory;
          return (
            <button
              key={accessory}
              type="button"
              className={worn ? "primary" : undefined}
              disabled={!unlocked || update.isPending}
              aria-pressed={worn}
              onClick={() => update.mutate({ accessory: worn ? null : accessory })}
            >
              {accessoryName(accessory)}
              {!unlocked && ` · ${UNLOCK_STREAKS[accessory]}-day streak`}
            </button>
          );
        })}
      </div>
      {update.error && <p className="error">{update.error.message}</p>}
    </>
  );
};

export const SettingsPage = () => {
  const view = usePet();

  if (view.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (view.error) {
    return <p className="error">{view.error.message}</p>;
  }
  const { pet, today } = view.data;
  return (
    <section className="panel">
      <h1>Settings</h1>
      {pet === null ? <p className="muted">Hatch your egg first.</p> : <SettingsForm pet={pet} today={today} />}
    </section>
  );
};
