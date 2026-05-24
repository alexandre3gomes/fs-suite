-- CreateTable: on-demand cache for rendered aerodrome chart overlays.
CREATE TABLE "aerodrome_chart_overlays" (
    "id" TEXT NOT NULL,
    "icao" TEXT NOT NULL,
    "chart_type" TEXT NOT NULL,
    "chart_name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_authority" TEXT NOT NULL,
    "page_index" INTEGER NOT NULL DEFAULT 0,
    "image_key" TEXT NOT NULL,
    "image_content_type" TEXT NOT NULL DEFAULT 'image/png',
    "image_width" INTEGER NOT NULL,
    "image_height" INTEGER NOT NULL,
    "bounds_south" DOUBLE PRECISION NOT NULL,
    "bounds_west" DOUBLE PRECISION NOT NULL,
    "bounds_north" DOUBLE PRECISION NOT NULL,
    "bounds_east" DOUBLE PRECISION NOT NULL,
    "rotation_deg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opacity_default" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "prepared_airac_cycle" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "aerodrome_chart_overlays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aerodrome_chart_overlays_icao_idx" ON "aerodrome_chart_overlays"("icao");

-- CreateIndex
CREATE UNIQUE INDEX "aerodrome_chart_overlays_source_url_prepared_airac_cycle_key" ON "aerodrome_chart_overlays"("source_url", "prepared_airac_cycle");

-- AddForeignKey
ALTER TABLE "aerodrome_chart_overlays" ADD CONSTRAINT "aerodrome_chart_overlays_icao_fkey" FOREIGN KEY ("icao") REFERENCES "airports"("icao") ON DELETE RESTRICT ON UPDATE CASCADE;
