import { useState } from "react";
import { PROPERTY_STATUSES, type PropertyStatus, type PropertySummary } from "../../../../contract";
import { STATUS_LABELS } from "../../../utils/format";
import { useUpdateStatus } from "../api/properties";
import { RejectForm } from "./RejectForm";

export const StatusControl = ({ property }: { property: Pick<PropertySummary, "id" | "status"> }) => {
  const updateStatus = useUpdateStatus();
  const [rejecting, setRejecting] = useState(false);

  if (rejecting) {
    return (
      <RejectForm
        onCancel={() => setRejecting(false)}
        onReject={(reason) =>
          updateStatus.mutate(
            { id: property.id, update: { status: "rejected", reason } },
            { onSuccess: () => setRejecting(false) },
          )
        }
      />
    );
  }

  return (
    <select
      value={property.status}
      aria-label="Status"
      onChange={(event) => {
        const status = event.target.value as PropertyStatus;
        if (status === "rejected") {
          setRejecting(true);
        } else {
          updateStatus.mutate({ id: property.id, update: { status } });
        }
      }}
    >
      {PROPERTY_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABELS[status]}
        </option>
      ))}
    </select>
  );
};
