import { z } from 'zod';

export const VulnProfileItemSchema = z.object({
  label: z.string().min(1).max(120),
  query: z.string().min(1).max(200),
  vendor: z.string().max(120).optional(),
  product: z.string().max(120).optional(),
  ecosystem: z.string().max(60).optional(),
});

export const UpsertVulnProfileSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  environment: z.enum(['APP', 'IT', 'OT', 'OTHER']).default('OTHER'),
  items: z.array(VulnProfileItemSchema).min(1).max(100),
});

export const VulnPreviewSchema = z.object({
  profileIds: z.array(z.string().min(1)).min(1),
  severities: z.array(z.string()).optional(),
  cvssMin: z.number().min(0).max(10).nullable().optional(),
  epssMin: z.number().min(0).max(1).nullable().optional(),
  isKevOnly: z.boolean().optional(),
  sources: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  days: z.number().int().min(1).max(90).default(7),
});
