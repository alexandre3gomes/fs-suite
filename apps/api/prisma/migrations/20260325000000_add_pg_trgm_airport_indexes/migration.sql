-- Enable pg_trgm extension for trigram-based fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes on Airport for fast search by ICAO code and name
CREATE INDEX "Airport_icao_trgm_idx" ON "Airport" USING GIN ("icao" gin_trgm_ops);
CREATE INDEX "Airport_name_trgm_idx" ON "Airport" USING GIN ("name" gin_trgm_ops);
