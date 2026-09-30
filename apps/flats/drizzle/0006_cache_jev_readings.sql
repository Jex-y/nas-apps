CREATE TABLE "flats"."readings" (
	"text_fingerprint" text NOT NULL,
	"question_fingerprint" text NOT NULL,
	"answer" jsonb NOT NULL,
	"model" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_text_fingerprint_question_fingerprint_pk" PRIMARY KEY("text_fingerprint","question_fingerprint")
);
--> statement-breakpoint
ALTER TABLE "flats"."listings" ADD COLUMN "text_fingerprint" text GENERATED ALWAYS AS (md5((parsed -> 'propertyType')::text || (parsed -> 'keyFeatures')::text || (parsed -> 'description')::text)) STORED;--> statement-breakpoint
INSERT INTO "flats"."readings" ("text_fingerprint", "question_fingerprint", "answer", "model", "read_at")
SELECT DISTINCT ON (latest."text_fingerprint", answered."fingerprint")
	latest."text_fingerprint", answered."fingerprint", answered."answer", answered."model", answered."extracted_at"
FROM "flats"."answers" AS answered
CROSS JOIN LATERAL (
	SELECT "text_fingerprint" FROM "flats"."listings"
	WHERE "property_id" = answered."property_id" AND "parsed" IS NOT NULL
	ORDER BY "parsed_at" DESC NULLS LAST
	LIMIT 1
) AS latest
WHERE latest."text_fingerprint" IS NOT NULL
ORDER BY latest."text_fingerprint", answered."fingerprint", answered."extracted_at" DESC;
