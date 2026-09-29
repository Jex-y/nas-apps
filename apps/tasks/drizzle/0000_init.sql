CREATE SCHEMA "tasks";
--> statement-breakpoint
CREATE TYPE "tasks"."status" AS ENUM('todo', 'doing', 'done');--> statement-breakpoint
CREATE TABLE "tasks"."dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_id" uuid NOT NULL,
	CONSTRAINT "dependencies_task_id_depends_on_id_pk" PRIMARY KEY("task_id","depends_on_id"),
	CONSTRAINT "no_self_dependency" CHECK ("tasks"."dependencies"."task_id" <> "tasks"."dependencies"."depends_on_id")
);
--> statement-breakpoint
CREATE TABLE "tasks"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "tasks"."status" DEFAULT 'todo' NOT NULL,
	"position" integer NOT NULL,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"start_on" date,
	"due_on" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks"."dependencies" ADD CONSTRAINT "dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "tasks"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks"."dependencies" ADD CONSTRAINT "dependencies_depends_on_id_tasks_id_fk" FOREIGN KEY ("depends_on_id") REFERENCES "tasks"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks"."tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "tasks"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dependencies_depends_on_id_index" ON "tasks"."dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "tasks_project_id_status_position_index" ON "tasks"."tasks" USING btree ("project_id","status","position");