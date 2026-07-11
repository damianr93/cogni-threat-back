import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import type { Prisma } from '@prisma/client';

const AlertSourceKeySchema = z.enum([
  'ransomware-live',
  'telegram-channel',
  'vuln-monitor',
]);

// El shape de `settings` depende de `sourceKey` (ver SOURCE_SCHEMAS en
// alerts.service.ts). Se valida como JSON genérico aquí; la validación
// específica de vuln-monitor ya la hace AlertsService.validateVulnSubscriptionSettings.
// El cast a Prisma.JsonValue es seguro: Zod ya garantizó un objeto JSON-serializable.
const SubscriptionSettingsSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => value as Prisma.JsonValue);

export const CreateAlertSubscriptionSchema = z.object({
  sourceKey: AlertSourceKeySchema,
  name: z.string().min(1).max(200),
  enabled: z.boolean().optional(),
  deliveryChannelId: z.string().min(1),
  settings: SubscriptionSettingsSchema.optional(),
});

export class CreateAlertSubscriptionDto extends createZodDto(
  CreateAlertSubscriptionSchema,
) {}

export const UpdateAlertSubscriptionSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  deliveryChannelId: z.string().min(1).optional(),
  settings: SubscriptionSettingsSchema.optional(),
});

export class UpdateAlertSubscriptionDto extends createZodDto(
  UpdateAlertSubscriptionSchema,
) {}
