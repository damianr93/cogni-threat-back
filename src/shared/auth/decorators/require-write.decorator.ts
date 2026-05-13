import { SetMetadata } from '@nestjs/common';

export const REQUIRE_WRITE = Symbol('requireWrite');

export const RequireWrite = () => SetMetadata(REQUIRE_WRITE, true);
