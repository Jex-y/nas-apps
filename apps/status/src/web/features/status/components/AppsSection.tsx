import type { Migrations, StatusReport } from "../../../../contract";
import { ProbeView, StatusDot } from "./Primitives";

const MigrationSummary = ({ state }: { readonly state: Migrations["state"] }) => {
  switch (state.kind) {
    case "current":
      return <span className="muted">{state.applied} applied, up to date</span>;
    case "pending":
      return (
        <span className="error">
          {state.pending} pending ({state.applied} applied)
        </span>
      );
    case "ahead":
      return (
        <span className="warning-text">
          {state.unknown} newer than this build ({state.applied} applied)
        </span>
      );
  }
};

export const AppsSection = ({ report }: { readonly report: StatusReport }) => (
  <section>
    <h2>Apps</h2>
    <ul className="cards">
      {report.apps.map((app) => (
        <li key={app.slug} className="card">
          <h3>
            <a href={`/${app.slug}/`}>{app.title}</a>
            <code className="muted push">/{app.slug}/</code>
          </h3>
          <p className="muted">
            <span className="figure">{app.jobs}</span> jobs, <span className="figure">{app.schedules}</span> schedules
          </p>
        </li>
      ))}
    </ul>
    <h2>Migrations</h2>
    <ProbeView probe={report.migrations}>
      {(migrations) => (
        <ul className="list">
          {migrations.map(({ slug, state }) => (
            <li key={slug}>
              <StatusDot up={state.kind === "current"} />
              <code>{slug}</code>
              <MigrationSummary state={state} />
            </li>
          ))}
        </ul>
      )}
    </ProbeView>
  </section>
);
