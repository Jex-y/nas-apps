import { PET_API, STALE_HEALTH_HOURS } from "../../../../contract";
import { formatSynced, isStale } from "../../../utils/format";
import { usePet } from "../../pet/api/pet";

const EXAMPLE = `{
  "days": [
    { "date": "2026-09-27", "steps": 9412 },
    { "date": "2026-09-28", "steps": 3180 }
  ]
}`;

const LastArrival = () => {
  const view = usePet();
  const lastHealthAt = view.data?.lastHealthAt;
  if (lastHealthAt === undefined) {
    return null;
  }
  if (lastHealthAt === null) {
    return <p className="notice">Nothing has arrived yet.</p>;
  }
  return isStale(lastHealthAt) ? (
    <p className="notice">Last data arrived {formatSynced(lastHealthAt)}. Check the Shortcut still runs.</p>
  ) : (
    <p className="muted">
      Last data arrived <strong>{formatSynced(lastHealthAt)}</strong>, {view.data?.today.steps.toLocaleString("en-GB")}{" "}
      steps today.
    </p>
  );
};

/** Apple Health has no web API, so an iOS Shortcut on the phone reads the totals and posts them here. */
export const ConnectPage = () => {
  const endpoint = `${window.location.origin}${PET_API}/health`;

  return (
    <section className="panel connect">
      <h1>Connect Apple Health</h1>
      <p>
        A Shortcut on your iPhone reads today's and yesterday's steps from Health and sends them here. The highest total
        for a day wins, so it is safe to run as often as you like.
      </p>
      <LastArrival />

      <h2>1. Build the Shortcut</h2>
      <p className="muted">
        In the Shortcuts app, tap <strong>+</strong>, name it <strong>Pet steps</strong>, and add these actions in
        order.
      </p>
      <ol className="steps">
        <li>
          <strong>Find Health Samples</strong>: Type <em>Steps</em>, filter <em>Start Date is today</em>, and under
          Options set <em>Group By</em> to <em>Day</em>. Grouping makes Health add up iPhone and Watch steps without
          counting them twice.
        </li>
        <li>
          <strong>Calculate Statistics</strong>: <em>Sum</em> of Health Samples.
        </li>
        <li>
          <strong>Round Number</strong>: round the Statistics Result to the ones place.
        </li>
        <li>
          <strong>Set Variable</strong>: name it <code>TodaySteps</code>, set to the Rounded Number.
        </li>
        <li>
          <strong>Adjust Date</strong>: <em>Get Start of Day</em> of Current Date, then <strong>Set Variable</strong>{" "}
          <code>Midnight</code> to it.
        </li>
        <li>
          <strong>Adjust Date</strong>: <em>Subtract 1 day</em> from <code>Midnight</code>, then{" "}
          <strong>Set Variable</strong> <code>Yesterday</code> to it.
        </li>
        <li>
          <strong>Find Health Samples</strong>: Type <em>Steps</em>, filter <em>Start Date is between</em>{" "}
          <code>Yesterday</code> and <code>Midnight</code>, <em>Group By Day</em>, sorted by <em>Start Date</em>,{" "}
          <em>Oldest First</em>, <em>Limit 1</em>.
        </li>
        <li>
          <strong>Calculate Statistics</strong> (Sum), then <strong>Round Number</strong> (ones place), then{" "}
          <strong>Set Variable</strong> <code>YesterdaySteps</code>.
        </li>
        <li>
          <strong>Format Date</strong>: <code>Yesterday</code> with Date Format <em>Custom</em> <code>yyyy-MM-dd</code>,
          then <strong>Set Variable</strong> <code>YesterdayDate</code>. Do the same with <em>Current Date</em> into{" "}
          <code>TodayDate</code>.
        </li>
        <li>
          <strong>Get Contents of URL</strong>: URL <code>{endpoint}</code>, Method <em>POST</em>, Header{" "}
          <code>Content-Type</code> = <code>application/json</code>, Request Body <em>JSON</em>. Add a field{" "}
          <code>days</code> of type <em>Array</em> holding two <em>Dictionary</em> items, each with a Text field{" "}
          <code>date</code> and a Number field <code>steps</code>: <code>YesterdayDate</code>/
          <code>YesterdaySteps</code>, then <code>TodayDate</code>/<code>TodaySteps</code>.
        </li>
      </ol>
      <p className="muted">It sends a body like this:</p>
      <pre>{EXAMPLE}</pre>
      <p className="muted">
        Optional: add <code>distanceMeters</code> and <code>activeEnergyKcal</code> numbers to each day the same way.
      </p>

      <h2>2. Run it once by hand</h2>
      <p>
        Tap the Shortcut with Tailscale connected. Allow it to read Steps from Health, and choose <em>Always Allow</em>{" "}
        when it asks to connect to this server. That answer is what lets the automations run without asking. The time
        above should update.
      </p>

      <h2>3. Make it run by itself</h2>
      <ol className="steps">
        <li>
          In Shortcuts, open <strong>Automation</strong>, tap <strong>+</strong>, choose <strong>App</strong>, pick a
          few apps you open through the day (Messages, Safari…), and tick <em>Is Opened</em>.
        </li>
        <li>
          Choose <strong>Run Immediately</strong>, turn off <em>Notify When Run</em>, tap Next and pick{" "}
          <strong>Pet steps</strong>.
        </li>
        <li>
          Add a second automation with <strong>Time of Day</strong> at 17:45, daily, also <em>Run Immediately</em>, so
          the 18:00 nudge counts your latest steps.
        </li>
      </ol>
      <p className="muted">
        Health cannot be read while the iPhone is locked, so a run then fails harmlessly and the next run with the phone
        unlocked catches up; sending yesterday again fills in any late-evening steps. Keep Tailscale on (or On Demand)
        so the phone can reach this server. After {STALE_HEALTH_HOURS} hours without data the pet warns you.
      </p>
    </section>
  );
};
