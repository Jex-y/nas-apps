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
CREATE TABLE "tasks"."reminders" (
	"owner" text NOT NULL,
	"date" date NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_owner_date_pk" PRIMARY KEY("owner","date")
);
--> statement-breakpoint
CREATE TABLE "tasks"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
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
CREATE INDEX "dependencies_depends_on_id_index" ON "tasks"."dependencies" USING btree ("depends_on_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_status_position_index" ON "tasks"."tasks" USING btree ("owner","status","position");