-- AlterTable
ALTER TABLE "flight_plans" ADD COLUMN     "estimated_arrival_utc" TIMESTAMP(3),
ADD COLUMN     "estimated_elapsed_min" INTEGER,
ADD COLUMN     "planned_departure_utc" TIMESTAMP(3),
ADD COLUMN     "total_distance_nm" DOUBLE PRECISION,
ADD COLUMN     "weather_basis" TEXT;
