-- CreateTable
CREATE TABLE "aircraft_profile_stations" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "label_key" TEXT NOT NULL,
    "default_kg" DOUBLE PRECISION NOT NULL,
    "max_kg" DOUBLE PRECISION NOT NULL,
    "arm" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "aircraft_profile_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aircraft_profile_stations_profile_id_idx" ON "aircraft_profile_stations"("profile_id");

-- AddForeignKey
ALTER TABLE "aircraft_profile_stations" ADD CONSTRAINT "aircraft_profile_stations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "aircraft_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MigrateData: Transfer stations from JSON column to relational table
INSERT INTO "aircraft_profile_stations" ("id", "profile_id", "station_id", "label_key", "default_kg", "max_kg", "arm")
SELECT
    md5(random()::text || clock_timestamp()::text || ap.id || (station->>'id')),
    ap.id,
    (station->>'id'),
    (station->>'labelKey'),
    (station->>'defaultKg')::double precision,
    (station->>'maxKg')::double precision,
    (station->>'arm')::double precision
FROM "aircraft_profiles" ap
CROSS JOIN LATERAL jsonb_array_elements(ap.stations::jsonb) AS station
WHERE ap.stations IS NOT NULL
  AND ap.stations::text != 'null'
  AND jsonb_typeof(ap.stations::jsonb) = 'array'
  AND jsonb_array_length(ap.stations::jsonb) > 0;

-- DropColumn
ALTER TABLE "aircraft_profiles" DROP COLUMN "stations";
