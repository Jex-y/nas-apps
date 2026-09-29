import { type FormEvent, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import type { ProjectView } from "../../../../contract";
import { NavLink } from "../../../components/NavLink";
import { HOME } from "../../../lib/routes";
import { BoardPage } from "../../board/components/BoardPage";
import { ListPage } from "../../tasks/components/ListPage";
import { TaskPage } from "../../tasks/components/TaskPage";
import { TimelinePage } from "../../timeline/components/TimelinePage";
import { useDeleteProject, useProject, useRenameProject } from "../api/projects";

type Section = { readonly href: string; readonly label: string; readonly icon: string };

/** 24×24 stroked icon paths; on phones the sections sit in a bottom tab bar within thumb reach. */
const SECTIONS: readonly Section[] = [
  { href: "/", label: "List", icon: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" },
  { href: "/board", label: "Board", icon: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z" },
  { href: "/timeline", label: "Timeline", icon: "M4 6h8M8 12h9M13 18h7M4 3v18" },
];

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
    <path d={path} />
  </svg>
);

const ProjectHeading = ({ project }: { project: ProjectView }) => {
  const rename = useRenameProject(project.id);
  const remove = useDeleteProject();
  const [, navigate] = useLocation();
  const [name, setName] = useState<string | null>(null);

  const save = (event: FormEvent) => {
    event.preventDefault();
    rename.mutate({ name: name ?? project.name }, { onSuccess: () => setName(null) });
  };

  const confirmDelete = () => {
    if (confirm(`Delete "${project.name}" and its ${project.tasks.length} tasks?`)) {
      remove.mutate(project.id, { onSuccess: () => navigate(HOME) });
    }
  };

  return name === null ? (
    <div className="page-heading">
      <h1>{project.name}</h1>
      <div className="actions">
        <button type="button" onClick={() => setName(project.name)}>
          Rename
        </button>
        <button type="button" onClick={confirmDelete} disabled={remove.isPending}>
          Delete project
        </button>
      </div>
    </div>
  ) : (
    <form className="page-heading inline-form" onSubmit={save}>
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Project name" required />
      <button type="submit" disabled={rename.isPending}>
        Save
      </button>
      <button type="button" onClick={() => setName(null)}>
        Cancel
      </button>
      {rename.error && <span className="error">{rename.error.message}</span>}
    </form>
  );
};

export const ProjectLayout = ({ projectId }: { projectId: string }) => {
  const project = useProject(projectId);

  if (project.isPending) {
    return <p className="muted">Loading…</p>;
  }
  if (project.error) {
    return <p className="error">{project.error.message}</p>;
  }

  return (
    <>
      <ProjectHeading project={project.data} />
      <nav className="sections" aria-label="Views">
        {SECTIONS.map(({ href, label }) => (
          <NavLink key={href} href={href} className="section-link">
            {label}
          </NavLink>
        ))}
      </nav>
      <Switch>
        <Route path="/">
          <ListPage project={project.data} />
        </Route>
        <Route path="/board">
          <BoardPage project={project.data} />
        </Route>
        <Route path="/timeline">
          <TimelinePage project={project.data} />
        </Route>
        <Route path="/tasks/:taskId">
          {({ taskId }) => <TaskPage key={taskId} project={project.data} taskId={taskId} />}
        </Route>
        <Route>
          <p className="muted">Nothing here.</p>
        </Route>
      </Switch>
      <nav className="tab-bar" aria-label="Views">
        {SECTIONS.map(({ href, label, icon }) => (
          <NavLink key={href} href={href} className="tab">
            <Icon path={icon} />
            {label}
          </NavLink>
        ))}
      </nav>
    </>
  );
};
