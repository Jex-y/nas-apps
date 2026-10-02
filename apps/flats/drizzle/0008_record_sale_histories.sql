CREATE TABLE "flats"."sale_histories" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"sales" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flats"."sale_histories" ADD CONSTRAINT "sale_histories_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;