CREATE TABLE "flats"."commutes" (
	"property_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"minutes" smallint,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commutes_property_id_destination_id_pk" PRIMARY KEY("property_id","destination_id")
);
--> statement-breakpoint
CREATE TABLE "flats"."destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"postcode" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"arrive_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flats"."commutes" ADD CONSTRAINT "commutes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats"."commutes" ADD CONSTRAINT "commutes_destination_id_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "flats"."destinations"("id") ON DELETE cascade ON UPDATE no action;