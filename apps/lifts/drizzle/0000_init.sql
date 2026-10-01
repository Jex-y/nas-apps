CREATE SCHEMA "lifts";
--> statement-breakpoint
CREATE TYPE "lifts"."competition_lift" AS ENUM('squat', 'bench', 'deadlift');--> statement-breakpoint
CREATE TYPE "lifts"."set_kind" AS ENUM('warmup', 'work');--> statement-breakpoint
CREATE TABLE "lifts"."entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "entries_owner_id_unique" UNIQUE("owner","id")
);
--> statement-breakpoint
CREATE TABLE "lifts"."exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"lift" "lifts"."competition_lift",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exercises_owner_id_unique" UNIQUE("owner","id"),
	CONSTRAINT "exercises_owner_lift_unique" UNIQUE("owner","lift")
);
--> statement-breakpoint
CREATE TABLE "lifts"."pushes" (
	"owner" text NOT NULL,
	"key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pushes_owner_key_pk" PRIMARY KEY("owner","key")
);
--> statement-breakpoint
CREATE TABLE "lifts"."sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"weight_kg" numeric(6, 2) NOT NULL,
	"reps" integer NOT NULL,
	"rpe" numeric(3, 1),
	"kind" "lifts"."set_kind" NOT NULL,
	"logged_at" timestamp with time zone NOT NULL,
	CONSTRAINT "weight_not_negative" CHECK ("lifts"."sets"."weight_kg" >= 0),
	CONSTRAINT "reps_not_negative" CHECK ("lifts"."sets"."reps" >= 0),
	CONSTRAINT "rpe_in_half_steps" CHECK ("lifts"."sets"."rpe" between 1 and 10 and "lifts"."sets"."rpe" * 2 = trunc("lifts"."sets"."rpe" * 2))
);
--> statement-breakpoint
CREATE TABLE "lifts"."workouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"date" date NOT NULL,
	"finished_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"bodyweight_kg" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workouts_owner_id_unique" UNIQUE("owner","id")
);
--> statement-breakpoint
ALTER TABLE "lifts"."entries" ADD CONSTRAINT "entries_owner_workout_id_workouts_owner_id_fk" FOREIGN KEY ("owner","workout_id") REFERENCES "lifts"."workouts"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."entries" ADD CONSTRAINT "entries_owner_exercise_id_exercises_owner_id_fk" FOREIGN KEY ("owner","exercise_id") REFERENCES "lifts"."exercises"("owner","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifts"."sets" ADD CONSTRAINT "sets_owner_entry_id_entries_owner_id_fk" FOREIGN KEY ("owner","entry_id") REFERENCES "lifts"."entries"("owner","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_owner_workout_id_index" ON "lifts"."entries" USING btree ("owner","workout_id");--> statement-breakpoint
CREATE INDEX "entries_owner_exercise_id_index" ON "lifts"."entries" USING btree ("owner","exercise_id");--> statement-breakpoint
CREATE INDEX "sets_owner_entry_id_index" ON "lifts"."sets" USING btree ("owner","entry_id");--> statement-breakpoint
CREATE INDEX "workouts_owner_date_index" ON "lifts"."workouts" USING btree ("owner","date");