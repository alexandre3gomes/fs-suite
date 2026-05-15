-- AlterTable
ALTER TABLE "activity_logs" RENAME CONSTRAINT "ActivityLog_pkey" TO "activity_logs_pkey";

-- AlterTable
ALTER TABLE "aircraft_profiles" RENAME CONSTRAINT "AircraftProfile_pkey" TO "aircraft_profiles_pkey";

-- AlterTable
ALTER TABLE "airports" RENAME CONSTRAINT "Airport_pkey" TO "airports_pkey";

-- AlterTable
ALTER TABLE "flight_plans" ADD COLUMN     "registration" TEXT;

-- AlterTable
ALTER TABLE "integration_connections" RENAME CONSTRAINT "IntegrationConnection_pkey" TO "integration_connections_pkey";

-- AlterTable
ALTER TABLE "oauth_accounts" RENAME CONSTRAINT "OAuthAccount_pkey" TO "oauth_accounts_pkey";

-- AlterTable
ALTER TABLE "runways" RENAME CONSTRAINT "Runway_pkey" TO "runways_pkey";

-- AlterTable
ALTER TABLE "sessions" RENAME CONSTRAINT "Session_pkey" TO "sessions_pkey";

-- AlterTable
ALTER TABLE "users" RENAME CONSTRAINT "User_pkey" TO "users_pkey";

-- RenameForeignKey
ALTER TABLE "activity_logs" RENAME CONSTRAINT "ActivityLog_userId_fkey" TO "activity_logs_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "aircraft_profiles" RENAME CONSTRAINT "AircraftProfile_userId_fkey" TO "aircraft_profiles_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "integration_connections" RENAME CONSTRAINT "IntegrationConnection_userId_fkey" TO "integration_connections_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "oauth_accounts" RENAME CONSTRAINT "OAuthAccount_userId_fkey" TO "oauth_accounts_user_id_fkey";

-- RenameForeignKey
ALTER TABLE "runways" RENAME CONSTRAINT "Runway_airportIcao_fkey" TO "runways_airport_icao_fkey";

-- RenameForeignKey
ALTER TABLE "sessions" RENAME CONSTRAINT "Session_userId_fkey" TO "sessions_user_id_fkey";

-- RenameIndex
ALTER INDEX "ActivityLog_createdAt_idx" RENAME TO "activity_logs_created_at_idx";

-- RenameIndex
ALTER INDEX "IntegrationConnection_userId_service_key" RENAME TO "integration_connections_user_id_service_key";

-- RenameIndex
ALTER INDEX "OAuthAccount_provider_providerAccountId_key" RENAME TO "oauth_accounts_provider_provider_account_id_key";

-- RenameIndex
ALTER INDEX "Runway_airportIcao_idx" RENAME TO "runways_airport_icao_idx";

-- RenameIndex
ALTER INDEX "Session_refreshTokenHash_key" RENAME TO "sessions_refresh_token_hash_key";

-- RenameIndex
ALTER INDEX "User_email_key" RENAME TO "users_email_key";
