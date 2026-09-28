import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  ACCESSORIES,
  type Animation,
  INTERACTIONS,
  type Interaction,
  type PetState,
  type Today,
  UNLOCK_STREAKS,
} from "../../../../contract";
import { capitalised, formatCount, SPECIES_NAMES, TRAIT_NOTES } from "../../../utils/format";
import { useInteract } from "../api/pet";
import { renderFrames } from "../sprites/scene";
import { Device } from "./Device";
import { HEART, PixelIcon } from "./PixelIcon";
import { Sprite } from "./Sprite";

/** A content pet ambles about between spells of standing still. */
const STROLL_MS = 4_000;
/** How long it stays delighted after a treat, a pat or a game. */
const REACTION_MS = 2_500;

const FULL_HEART = { h: "#ff5c8a" };
const EMPTY_HEART = { h: "currentColor" };

const LABELS: Readonly<Record<Interaction, string>> = { treat: "Treat", pet: "Pet", play: "Play" };

const useStroll = (enabled: boolean): boolean => {
  const [walking, setWalking] = useState(false);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const timer = setInterval(() => setWalking((value) => !value), STROLL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return enabled && walking;
};

const Meter = ({ label, value }: { label: string; value: number }) => (
  <div className="meter">
    <span className="label">{label}</span>
    <div className="cells" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the ten cells never reorder.
        <span key={index} className={index < Math.round(value / 10) ? "cell on" : "cell"} />
      ))}
    </div>
    <span className="numeric">{value}</span>
  </div>
);

const Walk = ({ today }: { today: Today }) => (
  <div className="walk">
    <div className="walk-figures">
      <span className="label">Today</span>
      <span className="numeric">
        <strong>{formatCount(today.steps)}</strong> / {formatCount(today.goal)} steps
      </span>
    </div>
    <div className="progress">
      <span style={{ width: `${Math.min(100, (100 * today.steps) / today.goal)}%` }} />
    </div>
    <p className="muted">
      {today.fed ? "Fed for today." : `${formatCount(today.goal - today.steps)} steps until the next meal.`}
    </p>
  </div>
);

const nextUnlock = (pet: PetState): string | null => {
  const locked = ACCESSORIES.find((accessory) => !pet.unlocked.includes(accessory));
  return locked === undefined
    ? null
    : `A ${UNLOCK_STREAKS[locked]}-day streak unlocks the ${locked.replace("_", " ")}.`;
};

export const PetPanel = ({ pet, today }: { pet: PetState; today: Today }) => {
  const interact = useInteract();
  const [reacting, setReacting] = useState(false);
  const away = pet.homecomingSteps !== null;
  const strolling = useStroll(!reacting && (pet.animation === "idle" || pet.animation === "happy"));
  const animation: Animation = reacting ? "happy" : strolling ? "walking" : pet.animation;
  const { species, stage, form, accessory } = pet;
  const frames = useMemo(
    () => renderFrames({ species, stage, form, accessory }, animation),
    [species, stage, form, accessory, animation],
  );

  useEffect(() => {
    if (!reacting) {
      return;
    }
    const timer = setTimeout(() => setReacting(false), REACTION_MS);
    return () => clearTimeout(timer);
  }, [reacting]);

  const unlock = nextUnlock(pet);
  const act = (kind: Interaction) => interact.mutate(kind, { onSuccess: () => setReacting(true) });

  const screen = away ? (
    <p className="away">
      {pet.name} ran away. Walk {formatCount(pet.homecomingSteps ?? 0)} more steps today to bring them home.
    </p>
  ) : (
    <div className={strolling ? "stage strolling" : "stage"}>
      <Sprite frames={frames} label={`${pet.name}, ${pet.condition}${pet.asleep ? " and asleep" : ""}`} />
    </div>
  );

  return (
    <section className="home">
      <Device screen={screen} dim={pet.asleep}>
        {INTERACTIONS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="device-button"
            disabled={pet.refusals[kind] !== null || interact.isPending}
            title={pet.refusals[kind] ?? undefined}
            onClick={() => act(kind)}
          >
            {LABELS[kind]}
            {kind === "treat" && <span className="numeric"> {pet.treats}</span>}
          </button>
        ))}
      </Device>
      {interact.error && <p className="error">{interact.error.message}</p>}

      <div className="panel">
        <div className="pet-heading">
          <h1>{pet.name}</h1>
          <span className={`badge ${pet.rarity}`}>{capitalised(pet.rarity)}</span>
        </div>
        <p className="muted">
          {[SPECIES_NAMES[pet.species], capitalised(pet.stage), pet.form && capitalised(pet.form)]
            .filter(Boolean)
            .join(" · ")}
          , {pet.ageDays === 0 ? "hatched today" : `${pet.ageDays} ${pet.ageDays === 1 ? "day" : "days"} old`}.{" "}
          {capitalised(pet.trait)}: {TRAIT_NOTES[pet.trait].toLowerCase()}
        </p>

        <Walk today={today} />

        {!away && (
          <div className="meters">
            <Meter label="Mood" value={pet.bars.mood} />
            <Meter label="Food" value={pet.bars.food} />
            <Meter label="Energy" value={pet.bars.energy} />
          </div>
        )}

        <dl className="facts">
          <div>
            <dt>Streak</dt>
            <dd className="numeric">
              {pet.streak} {pet.streak === 1 ? "day" : "days"}
            </dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd className="numeric">{pet.bestStreak}</dd>
          </div>
          <div>
            <dt>Treats</dt>
            <dd className="numeric">{pet.treats}</dd>
          </div>
          <div>
            <dt>Bond</dt>
            <dd className="hearts" title={`${pet.bond} bond`}>
              {Array.from({ length: 5 }, (_, index) => (
                <PixelIcon
                  // biome-ignore lint/suspicious/noArrayIndexKey: five fixed hearts.
                  key={index}
                  grid={HEART}
                  palette={index < pet.hearts ? FULL_HEART : EMPTY_HEART}
                  className="heart"
                />
              ))}
            </dd>
          </div>
        </dl>
        {unlock !== null && <p className="muted">{unlock}</p>}
        {pet.unlocked.length > 0 && (
          <p className="muted">
            <Link href="/settings">Choose an accessory</Link> from those {pet.name} has unlocked.
          </p>
        )}
      </div>
    </section>
  );
};
