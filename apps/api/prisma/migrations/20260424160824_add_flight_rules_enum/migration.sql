-- CreateEnum
CREATE TYPE "FlightRules" AS ENUM ('VFR', 'IFR', 'VFR_IFR', 'IFR_VFR');

-- AlterTable
ALTER TABLE "VfrFlightPlan" ADD COLUMN     "flightRules" "FlightRules" NOT NULL DEFAULT 'VFR';
