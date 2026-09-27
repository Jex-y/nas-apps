CREATE SCHEMA "jobs";
--> statement-breakpoint
CREATE TYPE "jobs"."job_state" AS ENUM('pending', 'dead');--> statement-breakpoint
CREATE TABLE "jobs"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" "jobs"."job_state" DEFAULT 'pending' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs"."schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"last_slot" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jobs_claimable_idx" ON "jobs"."jobs" USING btree ("run_at") WHERE "jobs"."jobs"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_pending_dedupe_key_idx" ON "jobs"."jobs" USING btree ("name","dedupe_key") WHERE "jobs"."jobs"."state" = 'pending' and "jobs"."jobs"."dedupe_key" is not null;