import type { UpdateAircraftProfileInput } from '@fs-suite/types';
import { PartialType } from '@nestjs/swagger';

import { CreateAircraftProfileDto } from './create-aircraft-profile.dto';

export class UpdateAircraftProfileDto extends PartialType(CreateAircraftProfileDto) implements UpdateAircraftProfileInput {}
