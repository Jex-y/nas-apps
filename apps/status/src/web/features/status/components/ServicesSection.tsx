import type { ReactNode } from "react";
import type { PostgresInfo, Probed, StatusReport } from "../../../../contract";
import { formatBytes, formatDuration, shortCommit } from "../utils/format";
import { Fact, StatusDot } from "./Primitives";

const ServiceCard = ({
  title,
  probe,
  children,
}: {
  readonly title: string;
  readonly probe: Probed<{ readonly latencyMs: number }>;
  readonly children?: ReactNode;
}) => (
  <article className="card">
    <h3>
      <StatusDot up={probe.status === "ok"} />
      {title}
      {probe.status === "ok" && <span className="figure muted push">{probe.value.latencyMs} ms</span>}
    </h3>
    {probe.status === "ok" ? children : <p className="error">{probe.error}</p>}
  </article>
);

const PostgresFacts = ({ postgres }: { readonly postgres: PostgresInfo }) => (
  <>
    <dl className="facts">
      <Fact label="Version">{postgres.version}</Fact>
      <Fact label="Database">{formatBytes(postgres.databaseBytes)}</Fact>
    </dl>
    <details>
      <summary className="muted">Size by schema</summary>
      <dl className="facts">
        {postgres.schemas.map((schema) => (
          <Fact key={schema.name} label={schema.name}>
            {formatBytes(schema.bytes)}
          </Fact>
        ))}
      </dl>
    </details>
  </>
);

export const ServicesSection = ({ report }: { readonly report: StatusReport }) => (
  <section>
    <h2>Services</h2>
    <div className="cards">
      <article className="card">
        <h3>
          <StatusDot up />
          Server
        </h3>
        <dl className="facts">
          <Fact label="Commit">
            {report.server.commit === null ? "local build" : shortCommit(report.server.commit)}
          </Fact>
          <Fact label="Up for">{formatDuration(report.server.uptimeSeconds * 1000)}</Fact>
          <Fact label="Bun">{report.server.bunVersion}</Fact>
        </dl>
      </article>
      <ServiceCard title="Postgres" probe={report.postgres}>
        {report.postgres.status === "ok" && <PostgresFacts postgres={report.postgres.value} />}
      </ServiceCard>
      <ServiceCard title="Object storage" probe={report.blob} />
    </div>
  </section>
);
