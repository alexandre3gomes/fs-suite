-- AlterTable
ALTER TABLE "aircraft_profiles" ADD COLUMN     "climb_rate_fpm" INTEGER,
ADD COLUMN     "climb_speed_kts" INTEGER,
ADD COLUMN     "descent_rate_fpm" INTEGER,
ADD COLUMN     "descent_speed_kts" INTEGER,
ADD COLUMN     "is_shared" BOOLEAN NOT NULL DEFAULT false;
