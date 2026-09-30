import { useState } from "react";
import { FACT_KEYS, type Requirements, type Workbench } from "../../../../contract";
import type { Driver, Row } from "../utils/rank";
import { FactsSection } from "./FactsSection";
import { JevSection } from "./JevSection";
import { RuleOutSection } from "./RuleOutSection";
import { WeightsSection } from "./WeightsSection";

type Section = "rules" | "jev" | "facts" | "weights";

/**
 * The requirements as four concerns: what rules a flat out, what Jev reads from a listing, the facts known without
 * Jev, and what everything is worth.
 */
export const VisualEditor = ({
  requirements,
  saved,
  onChange,
  rows,
  drivers,
  workbench,
}: {
  requirements: Requirements;
  saved: Requirements;
  onChange: (next: Requirements) => void;
  rows: readonly Row[];
  drivers: readonly Driver[];
  workbench: Workbench;
}) => {
  const [section, setSection] = useState<Section>("rules");
  const exclusions = requirements.questions.filter((question) => question.kind === "exclusion").length;
  const limits = Object.values(requirements.limits).filter((limit) => limit !== null).length;
  const read = requirements.questions.length - exclusions;
  const weights = read + requirements.facts.length;
  const tabs: readonly (readonly [Section, string, number])[] = [
    ["rules", "Rule out", limits + exclusions],
    ["jev", "Jev reads", read],
    ["facts", "Facts", FACT_KEYS.length],
    ["weights", "Weights", weights],
  ];

  return (
    <div className="visual-editor">
      <div className="editor-tabs" role="tablist" aria-label="Requirements">
        {tabs.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className={section === value ? "active" : undefined}
            onClick={() => setSection(value)}
          >
            {label}
            <span className="tab-count">{count}</span>
          </button>
        ))}
      </div>
      {section === "rules" && <RuleOutSection requirements={requirements} onChange={onChange} rows={rows} />}
      {section === "jev" && <JevSection requirements={requirements} saved={saved} onChange={onChange} rows={rows} />}
      {section === "facts" && (
        <FactsSection
          requirements={requirements}
          onChange={onChange}
          rows={rows}
          medianPricePerSqft={workbench.medianPricePerSqft}
          onWeigh={() => setSection("weights")}
        />
      )}
      {section === "weights" && (
        <WeightsSection
          requirements={requirements}
          onChange={onChange}
          rows={rows}
          drivers={drivers}
          medianPricePerSqft={workbench.medianPricePerSqft}
        />
      )}
    </div>
  );
};
