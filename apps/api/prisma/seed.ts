/**
 * Database seed script — Phase 3
 *
 * This script will download and import the OurAirports CSV dataset.
 * Implementation deferred to Phase 3 (Flight Planning Core).
 *
 * Ref: docs/technical-spec.md Section 7
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.warn('Seed script is not yet implemented. Will be wired in Phase 3 with OurAirports data.');
  // TODO Phase 3: download https://ourairports.com/data/airports.csv and seed Airport table
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
