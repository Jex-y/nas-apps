CREATE TABLE "flats"."answers" (
	"property_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"answer" jsonb NOT NULL,
	"model" text NOT NULL,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_property_id_question_key_pk" PRIMARY KEY("property_id","question_key")
);
--> statement-breakpoint
ALTER TABLE "flats"."answers" ADD CONSTRAINT "answers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;