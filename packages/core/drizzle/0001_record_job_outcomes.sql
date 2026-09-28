CREATE TYPE "jobs"."job_outcome" AS ENUM('completed', 'retrying', 'dead');--> statement-breakpoint
CREATE TABLE "jobs"."hourly_outcomes" (
	"name" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"outcome" "jobs"."job_outcome" NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "hourly_outcomes_name_hour_outcome_pk" PRIMARY KEY("name","hour","outcome")
);
--> statement-breakpoint
ALTER TABLE "jobs"."jobs" ADD COLUMN "failed_at" timestamp with time zone;