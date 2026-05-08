-- Enable pg_trgm for text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "VfrPlanStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- AlterTable
ALTER TABLE "Airport" ADD COLUMN     "type" TEXT;

-- Trigram indices for aerodrome text search
DROP INDEX IF EXISTS "Airport_icao_trgm_idx";
DROP INDEX IF EXISTS "Airport_name_trgm_idx";
CREATE INDEX "Airport_icao_trgm_idx" ON "Airport" USING gin ("icao" gin_trgm_ops);
CREATE INDEX "Airport_name_trgm_idx" ON "Airport" USING gin ("name" gin_trgm_ops);

-- CreateTable
CREATE TABLE "Runway" (
    "id" TEXT NOT NULL,
    "airportIcao" TEXT NOT NULL,
    "ident" TEXT NOT NULL,
    "lengthFt" INTEGER,
    "widthFt" INTEGER,
    "surfaceType" TEXT,
    "leIdent" TEXT,
    "leHeadingDeg" DOUBLE PRECISION,
    "leElevationFt" INTEGER,
    "heIdent" TEXT,
    "heHeadingDeg" DOUBLE PRECISION,
    "heElevationFt" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Runway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VfrFlightPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VfrPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "originIcao" TEXT NOT NULL,
    "originName" TEXT NOT NULL,
    "originElevationFt" INTEGER,
    "originRunwayInUse" TEXT,
    "originMetarRaw" TEXT,
    "destinationIcao" TEXT NOT NULL,
    "destinationName" TEXT NOT NULL,
    "destinationElevationFt" INTEGER,
    "destinationRunwayInUse" TEXT,
    "destinationMetarRaw" TEXT,
    "alternateIcao" TEXT,
    "alternateName" TEXT,
    "alternateElevationFt" INTEGER,
    "alternateRunwayInUse" TEXT,
    "alternateMetarRaw" TEXT,
    "routeText" TEXT,
    "cruiseLevel" TEXT,
    "todMinutes" INTEGER,
    "fuelConsumptionPerHour" DOUBLE PRECISION,
    "fuelCurrentTotal" DOUBLE PRECISION,
    "fuelReserveMinutes" INTEGER,
    "fuelRequiredTotal" DOUBLE PRECISION,
    "fuelPerWing" DOUBLE PRECISION,
    "enduranceMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "VfrFlightPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VfrFlightPlanVisualReference" (
    "id" TEXT NOT NULL,
    "flightPlanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "distanceNm" DOUBLE PRECISION,
    "timeMin" INTEGER,

    CONSTRAINT "VfrFlightPlanVisualReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VfrFlightPlanBriefingItem" (
    "id" TEXT NOT NULL,
    "flightPlanId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "VfrFlightPlanBriefingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Runway_airportIcao_idx" ON "Runway"("airportIcao");

-- CreateIndex
CREATE INDEX "VfrFlightPlan_userId_deletedAt_idx" ON "VfrFlightPlan"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "VfrFlightPlanVisualReference_flightPlanId_sequence_idx" ON "VfrFlightPlanVisualReference"("flightPlanId", "sequence");

-- CreateIndex
CREATE INDEX "VfrFlightPlanBriefingItem_flightPlanId_idx" ON "VfrFlightPlanBriefingItem"("flightPlanId");

-- AddForeignKey
ALTER TABLE "Runway" ADD CONSTRAINT "Runway_airportIcao_fkey" FOREIGN KEY ("airportIcao") REFERENCES "Airport"("icao") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VfrFlightPlan" ADD CONSTRAINT "VfrFlightPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VfrFlightPlanVisualReference" ADD CONSTRAINT "VfrFlightPlanVisualReference_flightPlanId_fkey" FOREIGN KEY ("flightPlanId") REFERENCES "VfrFlightPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VfrFlightPlanBriefingItem" ADD CONSTRAINT "VfrFlightPlanBriefingItem_flightPlanId_fkey" FOREIGN KEY ("flightPlanId") REFERENCES "VfrFlightPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
