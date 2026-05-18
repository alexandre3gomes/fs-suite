-- AlterTable: Expand AircraftProfile with performance fields and system templates
ALTER TABLE "aircraft_profiles"
  ADD COLUMN "manufacturer" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "empty_weight_kg" DOUBLE PRECISION,
  ADD COLUMN "mtow_kg" DOUBLE PRECISION,
  ADD COLUMN "fuel_capacity_l" DOUBLE PRECISION,
  ADD COLUMN "fuel_burn_lph" DOUBLE PRECISION,
  ADD COLUMN "stations" JSONB,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cloned_from_id" TEXT;

-- Rename cruise_speed to cruise_speed_kts
ALTER TABLE "aircraft_profiles" RENAME COLUMN "cruise_speed" TO "cruise_speed_kts";

-- Drop unused fuel_unit column
ALTER TABLE "aircraft_profiles" DROP COLUMN IF EXISTS "fuel_unit";

-- Make user_id nullable (null = system template)
ALTER TABLE "aircraft_profiles" ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "aircraft_profiles_icao_type_is_template_idx" ON "aircraft_profiles"("icao_type", "is_template");

-- AlterTable: Add aircraft snapshot fields to FlightPlan
ALTER TABLE "flight_plans"
  ADD COLUMN "empty_weight_kg" DOUBLE PRECISION,
  ADD COLUMN "fuel_capacity_l" DOUBLE PRECISION,
  ADD COLUMN "fuel_burn_lph" DOUBLE PRECISION,
  ADD COLUMN "aircraft_stations" JSONB;
