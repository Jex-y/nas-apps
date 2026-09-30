CREATE TABLE "flats"."crime" (
	"property_id" uuid PRIMARY KEY NOT NULL,
	"through_month" text NOT NULL,
	"months" smallint NOT NULL,
	"radius_metres" smallint NOT NULL,
	"by_category" jsonb NOT NULL,
	"counted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."crime_reports" (
	"id" bigint PRIMARY KEY NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."crime_tiles" (
	"tile" text NOT NULL,
	"month" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crime_tiles_tile_month_pk" PRIMARY KEY("tile","month")
);
--> statement-breakpoint
ALTER TABLE "flats"."crime" ADD CONSTRAINT "crime_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crime_reports_month_latitude_idx" ON "flats"."crime_reports" USING btree ("month","latitude");