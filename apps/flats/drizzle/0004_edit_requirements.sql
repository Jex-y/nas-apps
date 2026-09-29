CREATE TABLE "flats"."requirements" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirements_single_row" CHECK ("flats"."requirements"."id" = 1)
);
