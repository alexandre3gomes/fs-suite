-- Remove the communications feature (email broadcasts) and introduce a
-- persisted admin flag on users.

-- DropForeignKey
ALTER TABLE "email_deliveries" DROP CONSTRAINT "email_deliveries_communication_id_fkey";

-- DropForeignKey
ALTER TABLE "email_deliveries" DROP CONSTRAINT "email_deliveries_user_id_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- DropTable
DROP TABLE "communications";

-- DropTable
DROP TABLE "email_deliveries";

-- DropEnum
DROP TYPE "CommunicationStatus";

-- DropEnum
DROP TYPE "CommunicationType";

-- DropEnum
DROP TYPE "EmailDeliveryStatus";

-- Seed admin flag from the existing bootstrap allow-list (ADMIN_EMAILS) so the
-- current admin keeps access via the DB flag, not only the code fallback.
UPDATE "users" SET "is_admin" = true WHERE lower("email") IN ('alexandre3gomes@gmail.com');
