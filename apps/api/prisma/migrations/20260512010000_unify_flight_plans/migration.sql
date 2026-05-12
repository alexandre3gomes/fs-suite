-- Drop old split tables (data can be discarded per user confirmation)
DROP TABLE IF EXISTS "vfr_flight_plan_briefing_items" CASCADE;
DROP TABLE IF EXISTS "vfr_flight_plan_visual_references" CASCADE;
DROP TABLE IF EXISTS "vfr_flight_plans" CASCADE;
DROP TABLE IF EXISTS "flight_plan_routes" CASCADE;
DROP TABLE IF EXISTS "flight_plans" CASCADE;

-- Drop old enums
DROP TYPE IF EXISTS "VfrPlanStatus";
DROP TYPE IF EXISTS "FlightType";

-- Create unified flight_plans table
CREATE TABLE "flight_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "flight_rules" "FlightRules" NOT NULL DEFAULT 'VFR',

    -- Origin aerodrome (snapshot)
    "origin_icao" TEXT NOT NULL,
    "origin_name" TEXT NOT NULL,
    "origin_elevation_ft" INTEGER,
    "origin_runway_in_use" TEXT,
    "origin_metar_raw" TEXT,

    -- Destination aerodrome (snapshot)
    "destination_icao" TEXT NOT NULL,
    "destination_name" TEXT NOT NULL,
    "destination_elevation_ft" INTEGER,
    "destination_runway_in_use" TEXT,
    "destination_metar_raw" TEXT,

    -- Alternate aerodrome (optional)
    "alternate_icao" TEXT,
    "alternate_name" TEXT,
    "alternate_elevation_ft" INTEGER,
    "alternate_runway_in_use" TEXT,
    "alternate_metar_raw" TEXT,

    -- Aircraft
    "aircraft_type" TEXT,
    "aircraft_name" TEXT,
    "takeoff_weight_kg" DOUBLE PRECISION,
    "mtow_kg" DOUBLE PRECISION,
    "callsign" TEXT,
    "simbrief_ofp_id" TEXT,

    -- Route
    "route_text" TEXT,
    "cruise_level" TEXT,
    "planned_altitude" INTEGER,
    "remarks" TEXT,
    "tod_minutes" INTEGER,
    "tod_distance_nm" DOUBLE PRECISION,

    -- Fuel / endurance
    "fuel_consumption_per_hour" DOUBLE PRECISION,
    "fuel_current_total" DOUBLE PRECISION,
    "fuel_reserve_minutes" INTEGER,
    "fuel_required_total" DOUBLE PRECISION,
    "fuel_per_wing" DOUBLE PRECISION,
    "endurance_minutes" INTEGER,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "flight_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flight_plans_user_id_deleted_at_idx" ON "flight_plans"("user_id", "deleted_at");
ALTER TABLE "flight_plans" ADD CONSTRAINT "flight_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create flight_plan_routes table
CREATE TABLE "flight_plan_routes" (
    "id" TEXT NOT NULL,
    "flight_plan_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "waypoint_ident" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "airway" TEXT,

    CONSTRAINT "flight_plan_routes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flight_plan_routes_flight_plan_id_sequence_idx" ON "flight_plan_routes"("flight_plan_id", "sequence");
ALTER TABLE "flight_plan_routes" ADD CONSTRAINT "flight_plan_routes_flight_plan_id_fkey" FOREIGN KEY ("flight_plan_id") REFERENCES "flight_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create flight_plan_visual_references table
CREATE TABLE "flight_plan_visual_references" (
    "id" TEXT NOT NULL,
    "flight_plan_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "distance_nm" DOUBLE PRECISION,
    "time_min" INTEGER,

    CONSTRAINT "flight_plan_visual_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flight_plan_visual_references_flight_plan_id_sequence_idx" ON "flight_plan_visual_references"("flight_plan_id", "sequence");
ALTER TABLE "flight_plan_visual_references" ADD CONSTRAINT "flight_plan_visual_references_flight_plan_id_fkey" FOREIGN KEY ("flight_plan_id") REFERENCES "flight_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create flight_plan_briefing_items table
CREATE TABLE "flight_plan_briefing_items" (
    "id" TEXT NOT NULL,
    "flight_plan_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "flight_plan_briefing_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "flight_plan_briefing_items_flight_plan_id_idx" ON "flight_plan_briefing_items"("flight_plan_id");
ALTER TABLE "flight_plan_briefing_items" ADD CONSTRAINT "flight_plan_briefing_items_flight_plan_id_fkey" FOREIGN KEY ("flight_plan_id") REFERENCES "flight_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
