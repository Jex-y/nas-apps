CREATE SCHEMA "flats";
--> statement-breakpoint
CREATE TYPE "flats"."availability" AS ENUM('available', 'under_offer', 'sold_stc', 'removed');--> statement-breakpoint
CREATE TYPE "flats"."photo_kind" AS ENUM('photo', 'floorplan');--> statement-breakpoint
CREATE TYPE "flats"."portal" AS ENUM('rightmove', 'zoopla');--> statement-breakpoint
CREATE TYPE "flats"."property_status" AS ENUM('new', 'shortlisted', 'viewing_booked', 'viewed', 'offer_made', 'rejected');--> statement-breakpoint
CREATE TYPE "flats"."snapshot_source" AS ENUM('search', 'page');--> statement-breakpoint
CREATE TYPE "flats"."tenure" AS ENUM('freehold', 'leasehold', 'share_of_freehold', 'commonhold', 'unknown');--> statement-breakpoint
CREATE TABLE "flats"."listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"portal" "flats"."portal" NOT NULL,
	"portal_id" text NOT NULL,
	"url" text NOT NULL,
	"price" integer,
	"availability" "flats"."availability" DEFAULT 'available' NOT NULL,
	"parsed" jsonb,
	"parsed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_portal_id_unique" UNIQUE("portal","portal_id")
);
--> statement-breakpoint
CREATE TABLE "flats"."photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" "flats"."photo_kind" NOT NULL,
	"position" smallint NOT NULL,
	"source_url" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photos_listing_source_unique" UNIQUE("listing_id","source_url")
);
--> statement-breakpoint
CREATE TABLE "flats"."properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "flats"."property_status" DEFAULT 'new' NOT NULL,
	"rejected_reason" text,
	"notes" text DEFAULT '' NOT NULL,
	"address" text NOT NULL,
	"postcode" text,
	"outcode" text,
	"latitude" double precision,
	"longitude" double precision,
	"price" integer,
	"price_qualifier" text DEFAULT '' NOT NULL,
	"availability" "flats"."availability" DEFAULT 'available' NOT NULL,
	"property_type" text DEFAULT '' NOT NULL,
	"bedrooms" smallint,
	"bathrooms" smallint,
	"size_sqft" integer,
	"tenure" "flats"."tenure" DEFAULT 'unknown' NOT NULL,
	"lease_years_remaining" smallint,
	"annual_service_charge" numeric(10, 2),
	"annual_ground_rent" numeric(10, 2),
	"council_tax_band" text,
	"shared_ownership" boolean DEFAULT false NOT NULL,
	"auction" boolean DEFAULT false NOT NULL,
	"thumbnail_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"portal" "flats"."portal" NOT NULL,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_succeeded_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "searches_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "flats"."snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"listing_id" uuid NOT NULL,
	"source" "flats"."snapshot_source" NOT NULL,
	"price" integer,
	"availability" "flats"."availability" NOT NULL,
	"page_key" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."viewing_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"viewing_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."viewings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"rating" smallint,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flats"."listings" ADD CONSTRAINT "listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats"."photos" ADD CONSTRAINT "photos_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "flats"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats"."snapshots" ADD CONSTRAINT "snapshots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "flats"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats"."viewing_photos" ADD CONSTRAINT "viewing_photos_viewing_id_viewings_id_fk" FOREIGN KEY ("viewing_id") REFERENCES "flats"."viewings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flats"."viewings" ADD CONSTRAINT "viewings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "flats"."properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listings_property_id_index" ON "flats"."listings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "properties_status_first_seen_idx" ON "flats"."properties" USING btree ("status","first_seen_at");--> statement-breakpoint
CREATE INDEX "snapshots_listing_id_observed_at_index" ON "flats"."snapshots" USING btree ("listing_id","observed_at");--> statement-breakpoint
CREATE INDEX "viewing_photos_viewing_id_index" ON "flats"."viewing_photos" USING btree ("viewing_id");--> statement-breakpoint
CREATE INDEX "viewings_property_id_index" ON "flats"."viewings" USING btree ("property_id");