-- AlterTable
ALTER TABLE "aircraft_profiles" ADD COLUMN "data_completeness" TEXT NOT NULL DEFAULT 'skeleton';

-- Backfill existing records based on available data
UPDATE "aircraft_profiles" SET "data_completeness" = 'complete'
WHERE "empty_weight_kg" IS NOT NULL
  AND "mtow_kg" IS NOT NULL
  AND "fuel_capacity_l" IS NOT NULL
  AND "fuel_burn_lph" IS NOT NULL
  AND "cruise_speed_kts" IS NOT NULL
  AND "stations" IS NOT NULL
  AND jsonb_array_length("stations"::jsonb) > 0;

UPDATE "aircraft_profiles" SET "data_completeness" = 'partial'
WHERE "data_completeness" = 'skeleton'
  AND (
    "empty_weight_kg" IS NOT NULL
    OR "mtow_kg" IS NOT NULL
    OR "fuel_capacity_l" IS NOT NULL
    OR "fuel_burn_lph" IS NOT NULL
    OR "cruise_speed_kts" IS NOT NULL
  );
