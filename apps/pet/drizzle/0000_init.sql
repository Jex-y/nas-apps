CREATE SCHEMA "pet";
--> statement-breakpoint
CREATE TYPE "pet"."accessory" AS ENUM('bow', 'party_hat', 'crown');--> statement-breakpoint
CREATE TYPE "pet"."interaction" AS ENUM('treat', 'pet', 'play');--> statement-breakpoint
CREATE TYPE "pet"."nudge_kind" AS ENUM('evening', 'goal', 'stale');--> statement-breakpoint
CREATE TYPE "pet"."species" AS ENUM('chick', 'frog', 'cat', 'bunny', 'axolotl', 'dragon');--> statement-breakpoint
CREATE TYPE "pet"."trait" AS ENUM('cheerful', 'greedy', 'cuddly', 'playful', 'sleepy');--> statement-breakpoint
CREATE TABLE "pet"."days" (
	"login" text NOT NULL,
	"date" date NOT NULL,
	"steps" integer NOT NULL,
	"distance_meters" double precision,
	"active_energy_kcal" double precision,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "days_login_date_pk" PRIMARY KEY("login","date")
);
--> statement-breakpoint
CREATE TABLE "pet"."goals" (
	"pet_id" uuid NOT NULL,
	"since" date NOT NULL,
	"steps" integer NOT NULL,
	CONSTRAINT "goals_pet_id_since_pk" PRIMARY KEY("pet_id","since")
);
--> statement-breakpoint
CREATE TABLE "pet"."interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pet_id" uuid NOT NULL,
	"kind" "pet"."interaction" NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pet"."nudges" (
	"pet_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "pet"."nudge_kind" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nudges_pet_id_date_kind_pk" PRIMARY KEY("pet_id","date","kind")
);
--> statement-breakpoint
CREATE TABLE "pet"."pets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"login" text NOT NULL,
	"name" text NOT NULL,
	"species" "pet"."species" NOT NULL,
	"trait" "pet"."trait" NOT NULL,
	"accessory" "pet"."accessory",
	"hatched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pets_login_unique" UNIQUE("login")
);
--> statement-breakpoint
ALTER TABLE "pet"."goals" ADD CONSTRAINT "goals_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "pet"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet"."interactions" ADD CONSTRAINT "interactions_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "pet"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pet"."nudges" ADD CONSTRAINT "nudges_pet_id_pets_id_fk" FOREIGN KEY ("pet_id") REFERENCES "pet"."pets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interactions_pet_id_at_index" ON "pet"."interactions" USING btree ("pet_id","at");