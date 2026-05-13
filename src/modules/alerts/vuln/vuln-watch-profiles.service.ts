import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { UpsertVulnProfileSchema } from './dto/vuln-profile.dto';
import type { ProfileInput } from './vuln-alert.types';

@Injectable()
export class VulnWatchProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    return this.prisma.vulnWatchProfile.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, body: unknown) {
    const data = UpsertVulnProfileSchema.parse(body);
    return this.prisma.vulnWatchProfile.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        environment: data.environment,
        items: { create: data.items },
      },
      include: { items: true },
    });
  }

  async update(userId: string, id: string, body: unknown) {
    await this.ensureOwnership(userId, id);
    const data = UpsertVulnProfileSchema.parse(body);

    await this.prisma.vulnWatchProfileItem.deleteMany({ where: { profileId: id } });

    return this.prisma.vulnWatchProfile.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        environment: data.environment,
        items: { create: data.items },
      },
      include: { items: true },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwnership(userId, id);
    await this.prisma.vulnWatchProfile.delete({ where: { id } });
    return { success: true };
  }

  async ensureOwnership(userId: string, id: string) {
    const profile = await this.prisma.vulnWatchProfile.findFirst({ where: { id, userId } });
    if (!profile) throw new NotFoundException('Vuln watch profile not found');
    return profile;
  }

  async validateProfileIds(userId: string, profileIds: string[]) {
    if (!profileIds.length) {
      throw new BadRequestException('At least one profileId is required for vuln-monitor subscriptions');
    }
    const profiles = await this.prisma.vulnWatchProfile.findMany({
      where: { userId, id: { in: profileIds } },
      include: { items: true },
    });
    if (profiles.length !== profileIds.length) {
      throw new BadRequestException('One or more profileIds are invalid or do not belong to the user');
    }
    return profiles;
  }

  async loadProfilesByIds(userId: string, profileIds: string[]): Promise<ProfileInput[]> {
    const profiles = await this.prisma.vulnWatchProfile.findMany({
      where: { userId, id: { in: profileIds } },
      include: { items: true },
    });
    return profiles.map(toProfileInput);
  }

  async loadAllProfilesForSubscriptions(
    subscriptions: Array<{ userId: string; settings: unknown }>,
  ): Promise<Map<string, ProfileInput>> {
    const profileIds = new Set<string>();
    for (const sub of subscriptions) {
      const settings = sub.settings as { profileIds?: string[] };
      for (const id of settings?.profileIds ?? []) profileIds.add(id);
    }

    if (profileIds.size === 0) return new Map();

    const profiles = await this.prisma.vulnWatchProfile.findMany({
      where: { id: { in: Array.from(profileIds) } },
      include: { items: true },
    });

    return new Map(profiles.map((p) => [p.id, toProfileInput(p)]));
  }
}

function toProfileInput(profile: {
  id: string;
  name: string;
  environment: string;
  items: Array<{
    id: string;
    label: string;
    query: string;
    vendor: string | null;
    product: string | null;
    ecosystem: string | null;
  }>;
}): ProfileInput {
  return {
    id: profile.id,
    name: profile.name,
    environment: profile.environment,
    items: profile.items.map((item) => ({
      id: item.id,
      label: item.label,
      query: item.query,
      vendor: item.vendor,
      product: item.product,
      ecosystem: item.ecosystem,
    })),
  };
}
