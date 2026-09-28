import { REFRESH_MS, type StatusReport } from "../../../../contract";
import { useStatusReport } from "../api/report";
import { formatClock } from "../utils/format";
import { findProblems } from "../utils/problems";
import { AppsSection } from "./AppsSection";
import { FailuresSection } from "./FailuresSection";
import { QueueSection } from "./QueueSection";
import { SchedulesSection } from "./SchedulesSection";
import { ServicesSection } from "./ServicesSection";

const ProblemList = ({ report }: { readonly report: StatusReport }) => {
  const problems = findProblems(report);
  return problems.length === 0 ? (
    <p className="banner ok">All systems normal.</p>
  ) : (
    <ul className="problems">
      {problems.map((problem) => (
        <li key={problem.message} className={`banner ${problem.severity}`}>
          {problem.message}
        </li>
      ))}
    </ul>
  );
};

export const StatusPage = () => {
  const report = useStatusReport();

  return (
    <main>
      <a href="/" className="home-link">
        ‹ Apps
      </a>
      <header className="page-header">
        <h1>System status</h1>
        {report.data && (
          <p className="muted">
            Updated <span className="figure">{formatClock(report.data.generatedAt)}</span>, every {REFRESH_MS / 1000} s
          </p>
        )}
      </header>
      {report.isPending && <p className="muted">Loading…</p>}
      {report.error && (
        <p className="error">
          {report.data ? "Could not refresh, showing the last report: " : ""}
          {report.error.message}
        </p>
      )}
      {report.data && (
        <>
          <ProblemList report={report.data} />
          <ServicesSection report={report.data} />
          <QueueSection report={report.data} />
          <FailuresSection report={report.data} />
          <SchedulesSection report={report.data} />
          <AppsSection report={report.data} />
        </>
      )}
    </main>
  );
};
