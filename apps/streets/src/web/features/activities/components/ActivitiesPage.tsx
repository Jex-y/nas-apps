import type { Activity } from "../../../../contract";
import { formatDate, formatDistance } from "../../../utils/format";
import { useActivities } from "../api/activities";

const STATUS: Readonly<Record<Activity["status"], string>> = {
  pending: "Importing",
  matched: "",
  no_track: "No GPS",
};

export const ActivitiesPage = () => {
  const activities = useActivities();

  return (
    <section>
      <h1>Runs</h1>
      {activities.error && <p className="error">{activities.error.message}</p>}
      {activities.data?.length === 0 && <p className="muted">No runs yet. Connect Strava or upload GPX files.</p>}
      <ul className="activities">
        {activities.data?.map((activity) => (
          <li key={activity.id}>
            <div>
              <strong>{activity.name}</strong>
              <span className="muted">
                {formatDate(activity.startAt)} · {activity.sportType}
                {activity.distanceMetres !== null && ` · ${formatDistance(activity.distanceMetres)}`}
                {activity.source === "gpx" && " · GPX"}
              </span>
            </div>
            {STATUS[activity.status] ? (
              <span className="badge">{STATUS[activity.status]}</span>
            ) : (
              <span className={activity.newStreets > 0 ? "figure new-streets" : "figure muted"}>
                +{activity.newStreets}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
