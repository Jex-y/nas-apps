CREATE TABLE "flats"."map_layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"colour" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flats"."map_strokes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"layer_id" uuid NOT NULL,
	"points" jsonb NOT NULL,
	"width" smallint NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flats"."map_strokes" ADD CONSTRAINT "map_strokes_layer_id_map_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "flats"."map_layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_strokes_layer_id_created_at_index" ON "flats"."map_strokes" USING btree ("layer_id","created_at");