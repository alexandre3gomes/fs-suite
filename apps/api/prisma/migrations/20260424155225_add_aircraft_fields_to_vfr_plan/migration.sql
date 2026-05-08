-- AlterTable
ALTER TABLE "VfrFlightPlan" ADD COLUMN     "aircraftName" TEXT,
ADD COLUMN     "aircraftType" TEXT,
ADD COLUMN     "mtowKg" DOUBLE PRECISION,
ADD COLUMN     "takeoffWeightKg" DOUBLE PRECISION;
