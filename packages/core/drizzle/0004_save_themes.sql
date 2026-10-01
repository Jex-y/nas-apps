CREATE SCHEMA "shell";
--> statement-breakpoint
CREATE TABLE "shell"."themes" (
	"login" text PRIMARY KEY NOT NULL,
	"theme" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
