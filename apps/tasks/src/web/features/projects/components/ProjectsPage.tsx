import { type FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateProject, useProjects } from "../api/projects";

const NewProjectForm = () => {
  const create = useCreateProject();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ name }, { onSuccess: (project) => navigate(`/${project.id}`) });
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="New project"
        aria-label="Project name"
        maxLength={80}
        required
      />
      <button type="submit" disabled={create.isPending}>
        Create
      </button>
      {create.error && <span className="error">{create.error.message}</span>}
    </form>
  );
};

export const ProjectsPage = () => {
  const projects = useProjects();

  return (
    <section>
      <h1>Projects</h1>
      <NewProjectForm />
      {projects.isPending && <p className="muted">Loading…</p>}
      {projects.error && <p className="error">{projects.error.message}</p>}
      {projects.data?.length === 0 && <p className="muted">No projects yet.</p>}
      <ul className="projects">
        {projects.data?.map(({ id, name, counts }) => {
          const total = counts.todo + counts.doing + counts.done;
          return (
            <li key={id}>
              <Link href={`/${id}`} className="project-link">
                <span className="project-name">{name}</span>
                <span className="muted numeric">
                  {counts.done}/{total} done{counts.doing > 0 && ` · ${counts.doing} in progress`}
                </span>
                <progress max={Math.max(total, 1)} value={counts.done} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
