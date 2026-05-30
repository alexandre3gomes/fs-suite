-- CreateEnum
CREATE TYPE "FlightPlanRouteRole" AS ENUM ('MAIN', 'ALTERNATE');

-- DropIndex
DROP INDEX "flight_plan_routes_flight_plan_id_sequence_idx";

-- AlterTable
ALTER TABLE "flight_plan_routes" ADD COLUMN     "role" "FlightPlanRouteRole" NOT NULL DEFAULT 'MAIN';

-- AlterTable
ALTER TABLE "flight_plans" ADD COLUMN     "alternate_planned_altitude" INTEGER,
ADD COLUMN     "alternate_route_text" TEXT,
ADD COLUMN     "alternate_total_distance_nm" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "flight_plan_routes_flight_plan_id_role_sequence_idx" ON "flight_plan_routes"("flight_plan_id", "role", "sequence");
