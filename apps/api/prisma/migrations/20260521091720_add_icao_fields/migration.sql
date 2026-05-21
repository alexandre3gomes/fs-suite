-- AlterTable
ALTER TABLE "flight_plans" ADD COLUMN     "aircraft_color_markings" TEXT,
ADD COLUMN     "cruise_speed_kts" INTEGER,
ADD COLUMN     "equipment_code" TEXT,
ADD COLUMN     "persons_on_board" INTEGER,
ADD COLUMN     "pilot_in_command" TEXT,
ADD COLUMN     "surveillance_code" TEXT;
