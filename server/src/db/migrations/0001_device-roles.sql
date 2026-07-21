ALTER TABLE "devices" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_role_check" CHECK ("devices"."role" in ('owner', 'member'));--> statement-breakpoint
UPDATE "devices" d SET "role" = 'owner'
WHERE d."id" = (
  SELECT d2."id" FROM "devices" d2
  WHERE d2."user_id" = d."user_id"
  ORDER BY d2."created_at" ASC, d2."id" ASC
  LIMIT 1
);
