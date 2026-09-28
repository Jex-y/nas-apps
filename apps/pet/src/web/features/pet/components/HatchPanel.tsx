import { type FormEvent, useMemo, useState } from "react";
import { useHatch } from "../api/pet";
import { renderEgg } from "../sprites/scene";
import { Device } from "./Device";
import { Sprite } from "./Sprite";

export const HatchPanel = () => {
  const hatch = useHatch();
  const [name, setName] = useState("");
  const frames = useMemo(() => renderEgg(hatch.isPending), [hatch.isPending]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    hatch.mutate({ name });
  };

  return (
    <section className="home">
      <Device screen={<Sprite frames={frames} label="An egg, rocking gently" />}>
        <span className="device-label">Egg</span>
      </Device>
      <div className="panel">
        <h1>An egg!</h1>
        <p className="muted">
          Name it and it hatches. What is inside is a surprise: six species, some rarer than others. It lives on your
          walking, so connect Apple Health too.
        </p>
        <form className="hatch-form" onSubmit={submit}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name, e.g. Pip"
            aria-label="Name"
            maxLength={24}
            required
          />
          <button type="submit" disabled={hatch.isPending}>
            Hatch
          </button>
        </form>
        {hatch.error && <p className="error">{hatch.error.message}</p>}
      </div>
    </section>
  );
};
