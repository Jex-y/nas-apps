CREATE SCHEMA "notes";
--> statement-breakpoint
CREATE TABLE "notes"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "notes_owner_created_at_idx" ON "notes"."notes" USING btree ("owner","created_at");