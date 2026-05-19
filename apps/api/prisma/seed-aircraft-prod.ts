import { PrismaClient } from '@prisma/client';

import { seedAircraft } from './seed-aircraft';
import { enrichAircraftProfiles } from './seed-enrich';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await seedAircraft(prisma);
  await enrichAircraftProfiles(prisma);
}

main()
  .catch((e) => {
    console.error('Aircraft seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
