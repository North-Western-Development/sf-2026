ALTER TABLE "push_tokens" ADD COLUMN "kind" text DEFAULT 'apns' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "p256dh" text;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "auth" text;--> statement-breakpoint
-- Expo push tokens: push no longer goes through Expo, so they can never be used again.
DELETE FROM "push_tokens" WHERE "token" LIKE 'Expo%PushToken[%';
