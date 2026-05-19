-- DropForeignKey
ALTER TABLE "aircraft_profiles" DROP CONSTRAINT "aircraft_profiles_user_id_fkey";

-- AlterTable
ALTER TABLE "flight_plan_visual_references" ADD COLUMN     "ground_speed_kts" INTEGER,
ADD COLUMN     "magnetic_heading" INTEGER,
ADD COLUMN     "wind_correction_angle" INTEGER;

-- AlterTable
ALTER TABLE "flight_plans" ADD COLUMN     "avg_wind_direction" INTEGER,
ADD COLUMN     "avg_wind_speed" INTEGER,
ADD COLUMN     "ground_speed" INTEGER;

-- AddForeignKey
ALTER TABLE "aircraft_profiles" ADD CONSTRAINT "aircraft_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
