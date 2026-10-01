CREATE SCHEMA "streets";
--> statement-breakpoint
CREATE TYPE "streets"."activity_source" AS ENUM('strava', 'gpx');--> statement-breakpoint
CREATE TYPE "streets"."activity_status" AS ENUM('pending', 'matched', 'no_track');--> statement-breakpoint
CREATE TYPE "streets"."backfill_state" AS ENUM('running', 'done');--> statement-breakpoint
CREATE TABLE "streets"."activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"source" "streets"."activity_source" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"sport_type" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"distance_metres" real,
	"status" "streets"."activity_status" DEFAULT 'pending' NOT NULL,
	"track_key" text,
	"south" double precision,
	"west" double precision,
	"north" double precision,
	"east" double precision,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_login_source_external_unique" UNIQUE("login","source","external_id")
);
--> statement-breakpoint
CREATE TABLE "streets"."boroughs" (
	"id" bigint PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"boundary" jsonb,
	"south" double precision,
	"west" double precision,
	"north" double precision,
	"east" double precision,
	"generation" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "streets"."connections" (
	"login" text PRIMARY KEY NOT NULL,
	"athlete_id" bigint NOT NULL,
	"athlete_name" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"include_walks" boolean DEFAULT false NOT NULL,
	"backfill" "streets"."backfill_state" DEFAULT 'running' NOT NULL,
	"backfill_finished_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_athlete_id_unique" UNIQUE("athlete_id")
);
--> statement-breakpoint
CREATE TABLE "streets"."node_hits" (
	"login" text NOT NULL,
	"node_id" integer NOT NULL,
	"activity_id" uuid NOT NULL,
	"hit_at" timestamp with time zone NOT NULL,
	CONSTRAINT "node_hits_login_node_id_pk" PRIMARY KEY("login","node_id")
);
--> statement-breakpoint
CREATE TABLE "streets"."nodes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streets"."nodes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"street_id" integer NOT NULL,
	"key" bigint NOT NULL,
	"lat" real NOT NULL,
	"lon" real NOT NULL,
	"cell" integer NOT NULL,
	"generation" integer NOT NULL,
	CONSTRAINT "nodes_street_key_unique" UNIQUE("street_id","key")
);
--> statement-breakpoint
CREATE TABLE "streets"."refreshes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streets"."refreshes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tiles" integer DEFAULT 0 NOT NULL,
	"tiles_done" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "streets"."segments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streets"."segments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"street_id" integer NOT NULL,
	"way_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"cell" integer NOT NULL,
	"path" jsonb NOT NULL,
	"generation" integer NOT NULL,
	CONSTRAINT "segments_way_seq_unique" UNIQUE("way_id","seq")
);
--> statement-breakpoint
CREATE TABLE "streets"."street_progress" (
	"login" text NOT NULL,
	"street_id" integer NOT NULL,
	"hit_count" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_activity_id" uuid,
	CONSTRAINT "street_progress_login_street_id_pk" PRIMARY KEY("login","street_id")
);
--> statement-breakpoint
CREATE TABLE "streets"."streets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streets"."streets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"borough_id" bigint NOT NULL,
	"name" text NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"center_lat" double precision,
	"center_lon" double precision,
	"cell" integer,
	CONSTRAINT "streets_borough_name_unique" UNIQUE("borough_id","name")
);
--> statement-breakpoint
ALTER TABLE "streets"."node_hits" ADD CONSTRAINT "node_hits_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "streets"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."node_hits" ADD CONSTRAINT "node_hits_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "streets"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."nodes" ADD CONSTRAINT "nodes_street_id_streets_id_fk" FOREIGN KEY ("street_id") REFERENCES "streets"."streets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."segments" ADD CONSTRAINT "segments_street_id_streets_id_fk" FOREIGN KEY ("street_id") REFERENCES "streets"."streets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."street_progress" ADD CONSTRAINT "street_progress_street_id_streets_id_fk" FOREIGN KEY ("street_id") REFERENCES "streets"."streets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."street_progress" ADD CONSTRAINT "street_progress_completed_activity_id_activities_id_fk" FOREIGN KEY ("completed_activity_id") REFERENCES "streets"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "streets"."streets" ADD CONSTRAINT "streets_borough_id_boroughs_id_fk" FOREIGN KEY ("borough_id") REFERENCES "streets"."boroughs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_login_start_at_index" ON "streets"."activities" USING btree ("login","start_at");--> statement-breakpoint
CREATE INDEX "node_hits_activity_id_index" ON "streets"."node_hits" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "nodes_cell_index" ON "streets"."nodes" USING btree ("cell");--> statement-breakpoint
CREATE INDEX "segments_cell_index" ON "streets"."segments" USING btree ("cell");--> statement-breakpoint
CREATE INDEX "street_progress_login_completed_at_index" ON "streets"."street_progress" USING btree ("login","completed_at");--> statement-breakpoint
CREATE INDEX "street_progress_completed_activity_id_index" ON "streets"."street_progress" USING btree ("completed_activity_id");--> statement-breakpoint
CREATE INDEX "streets_cell_index" ON "streets"."streets" USING btree ("cell");