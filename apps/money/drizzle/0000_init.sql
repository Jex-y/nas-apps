CREATE SCHEMA "money";
--> statement-breakpoint
CREATE TYPE "money"."kind" AS ENUM('cash', 'investment', 'property', 'pension', 'debt', 'other');--> statement-breakpoint
CREATE TABLE "money"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"kind" "money"."kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money"."authorisations" (
	"state" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"institution" text NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money"."balances" (
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "balances_account_id_date_pk" PRIMARY KEY("account_id","date")
);
--> statement-breakpoint
CREATE TABLE "money"."bank_links" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"identification_hash" text NOT NULL,
	"uid" text NOT NULL,
	CONSTRAINT "bank_links_connection_id_identification_hash_unique" UNIQUE("connection_id","identification_hash")
);
--> statement-breakpoint
CREATE TABLE "money"."connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"institution" text NOT NULL,
	"country" text NOT NULL,
	"session_id" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"expiry_warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connections_owner_institution_country_unique" UNIQUE("owner","institution","country")
);
--> statement-breakpoint
CREATE TABLE "money"."holdings" (
	"account_id" uuid NOT NULL,
	"code" text NOT NULL,
	"units" double precision NOT NULL,
	"cost" bigint,
	CONSTRAINT "holdings_account_id_code_pk" PRIMARY KEY("account_id","code")
);
--> statement-breakpoint
CREATE TABLE "money"."line_item_tags" (
	"line_item_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "line_item_tags_line_item_id_tag_id_pk" PRIMARY KEY("line_item_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "money"."line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "line_items_transaction_id_position_unique" UNIQUE("transaction_id","position")
);
--> statement-breakpoint
CREATE TABLE "money"."portfolios" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"cash" bigint NOT NULL,
	"imported_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money"."securities" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"price" double precision NOT NULL,
	"priced_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_owner_name_unique" UNIQUE("owner","name")
);
--> statement-breakpoint
CREATE TABLE "money"."transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"booked_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"counterparty" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_account_id_reference_unique" UNIQUE("account_id","reference")
);
--> statement-breakpoint
ALTER TABLE "money"."balances" ADD CONSTRAINT "balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "money"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."bank_links" ADD CONSTRAINT "bank_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "money"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."bank_links" ADD CONSTRAINT "bank_links_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "money"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."holdings" ADD CONSTRAINT "holdings_account_id_portfolios_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "money"."portfolios"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."holdings" ADD CONSTRAINT "holdings_code_securities_code_fk" FOREIGN KEY ("code") REFERENCES "money"."securities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."line_item_tags" ADD CONSTRAINT "line_item_tags_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "money"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."line_item_tags" ADD CONSTRAINT "line_item_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "money"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."line_items" ADD CONSTRAINT "line_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "money"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."portfolios" ADD CONSTRAINT "portfolios_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "money"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money"."transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "money"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_owner_index" ON "money"."accounts" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "holdings_code_index" ON "money"."holdings" USING btree ("code");--> statement-breakpoint
CREATE INDEX "line_item_tags_tag_id_index" ON "money"."line_item_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "transactions_account_id_booked_on_index" ON "money"."transactions" USING btree ("account_id","booked_on");