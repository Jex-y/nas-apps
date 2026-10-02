# Lifts

A strength training log built for powerlifting: each tailnet login keeps its own, which nobody else sees. A workout
holds exercises in order, each with its sets: weight, reps, an optional RPE, and whether it was a warm-up.

- **Log**: the session under way. A new one starts from a past session's exercises or empty. Each exercise is a
  table with last session's sets laid out to do again, each beside what was lifted then; one tap ticks a set off,
  and a bar by the thumb asks its RPE. Change a weight and the matching sets below follow. A clock at the top counts
  the rest since the last set, and a set that beats the best estimated max is marked as a record.
- **History**: every workout, newest first, each open to correction.
- **Exercises**: the estimated squat, bench and deadlift maxes and their total, then each exercise with its trend,
  the heaviest set at each rep count and every session.

Estimated one-rep maxes come from the Reactive Training Systems RPE chart, taking a set without an RPE as all-out;
warm-ups never count. That arithmetic is in `src/strength.ts`, pure and shared by the server and the UI.

## It works without a connection

The app opens and logs with no network, as a gym basement requires. The device keeps a copy of the log and a queue
of changes not yet sent, shows every change at once, and sends the queue in order when the server is next reachable;
a banner counts what is waiting. Until then those changes exist only on that device, so install the app to the Home
Screen: iOS may clear the storage of a site that is only visited in Safari.

Each row's id is made on the device, a change writes the whole row, and each batch carries a key the server
remembers for thirty days, so a batch sent twice lands once. Two devices changing the same row leave whichever
change arrived last. If the server refuses a change, for instance a set for a workout since deleted elsewhere, the
device undoes it and says why.

The local copy is [TanStack DB](https://tanstack.com/db) collections persisted to SQLite in the browser. Its
packages are pinned to exact versions that were tested together; check that the app still loads and still restores
its rows offline before moving them.

## Manage the log from Claude

The lifts tools (read workouts, exercise histories, estimated maxes and rep records; log whole workouts or single
sets; correct and delete them) are on the stack's MCP server with every other app's, or alone at
`https://apps.<tailnet>.ts.net/lifts/mcp`. They act as the same Tailscale identity as the web app, and what they
change shows on a device the next time it syncs.
