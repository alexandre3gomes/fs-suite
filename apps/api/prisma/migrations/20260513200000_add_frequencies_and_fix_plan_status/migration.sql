-- Fix PlanStatus enum: rename SAVED to COMPLETED
UPDATE "flight_plans" SET "status" = 'DRAFT' WHERE "status" = 'SAVED';
ALTER TYPE "PlanStatus" RENAME VALUE 'SAVED' TO 'COMPLETED';

-- CreateTable
CREATE TABLE "frequencies" (
    "id" TEXT NOT NULL,
    "airport_icao" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "frequency_mhz" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "frequencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "frequencies_airport_icao_idx" ON "frequencies"("airport_icao");

-- AddForeignKey
ALTER TABLE "frequencies" ADD CONSTRAINT "frequencies_airport_icao_fkey" FOREIGN KEY ("airport_icao") REFERENCES "airports"("icao") ON DELETE CASCADE ON UPDATE CASCADE;
