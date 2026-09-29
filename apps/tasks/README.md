# Tasks

A personal to-do list whose tasks can wait on one another: each tailnet login keeps its own, which
nobody else sees. There are three views of the same tasks:

- **List**: the tasks in stages, each waiting only on tasks in earlier stages, with a checkbox to finish one.
- **Board**: To do, Doing and Done columns. Cards drag between and within columns; on touch each card has a menu.
- **Timeline**: a Gantt chart of the critical-path schedule, from each task's duration, its "not before" date and
  what it waits on, with arrows for dependencies, the critical path in red, due dates and today marked.

The API refuses any dependency that would close a cycle, and only lets a task leave To do once everything it waits
on is done (and a done task reopen only while nothing that waits on it has started). The graph and schedule logic in
`src/plan.ts` is pure and shared by the server and the UI.

From 08:00 London time, anyone with a task overdue, due today or tomorrow, or scheduled to miss its due date gets
one push notification a day, on their own devices only.

## Manage tasks from Claude

The app serves an MCP server at `https://apps.<tailnet>.ts.net/tasks/mcp` (Streamable HTTP, stateless), with tools
to read your list with its critical-path schedule and to create, edit, move, link and delete tasks. It acts as the
same Tailscale identity as the web app, so it only ever sees your own tasks, and it works from any client on a
tailnet device, e.g. Claude Code:

```sh
claude mcp add --transport http --scope user tasks https://apps.<tailnet>.ts.net/tasks/mcp
```

Clients that connect from the cloud rather than your device, such as claude.ai's custom connectors, cannot reach
the tailnet.
