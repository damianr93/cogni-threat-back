import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RiskLevel as PrismaRiskLevel } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../shared/database/prisma.service';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';

const RiskLevel = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const RiskStatus = z.enum([
  'IDENTIFIED',
  'ANALYZED',
  'TREATMENT_DEFINED',
  'TREATED',
  'ACCEPTED',
  'CLOSED',
]);
const TreatmentOption = z.enum(['MITIGATE', 'ACCEPT', 'TRANSFER', 'AVOID']);
const TreatmentStatus = z.enum([
  'PLANNED',
  'IN_PROGRESS',
  'IMPLEMENTED',
  'VERIFIED',
]);
const ActionStatus = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
const ControlStatus = z.enum([
  'DRAFT',
  'ACTIVE',
  'MONITORING',
  'NEEDS_ATTENTION',
  'RETIRED',
]);
const KpiDirection = z.enum(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER']);
const KpiFrequency = z.enum([
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
]);
const KpiMetricType = z.enum(['NUMBER', 'PERCENTAGE', 'RATIO', 'INDEX']);

const optionalText = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((value) => value || undefined);
const rating = z.coerce.number().int().min(1).max(5);
const scoreInput = z.coerce.number().int().min(1).max(5);
const dateInput = z
  .string()
  .datetime()
  .or(z.string().date())
  .optional()
  .nullable();
const evidenceUrl = z
  .string()
  .trim()
  .url()
  .optional()
  .nullable()
  .transform((value) => value || undefined);

const AssetSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  criticality: RiskLevel.default('MEDIUM'),
  confidentiality: rating,
  integrity: rating,
  availability: rating,
  ownerName: optionalText,
  businessContext: optionalText,
  description: optionalText,
  tags: z.array(z.string().trim().min(1)).default([]),
  isActive: z.boolean().optional(),
});

const RiskSchema = z.object({
  assetId: z.string().min(1),
  title: z.string().trim().min(1),
  scenario: z.string().trim().min(1),
  threat: z.string().trim().min(1),
  vulnerability: z.string().trim().min(1),
  threatSource: optionalText,
  affectedCia: z.array(z.string()).default(['C', 'I', 'A']),
  likelihood: scoreInput,
  impact: scoreInput,
  residualLikelihood: scoreInput.optional().nullable(),
  residualImpact: scoreInput.optional().nullable(),
  status: RiskStatus.default('IDENTIFIED'),
  ownerUserId: optionalText,
  ownerName: optionalText,
  isActive: z.boolean().optional(),
});

const TreatmentSchema = z.object({
  riskId: z.string().min(1),
  strategy: TreatmentOption,
  plan: z.string().trim().min(1),
  responsibleUserId: optionalText,
  responsibleName: optionalText,
  dueDate: dateInput,
  residualLikelihood: scoreInput.optional().nullable(),
  residualImpact: scoreInput.optional().nullable(),
  acceptedBy: optionalText,
  acceptedAt: dateInput,
  status: TreatmentStatus.default('PLANNED'),
});

const ActionSchema = z.object({
  title: z.string().trim().min(1),
  description: optionalText,
  ownerName: optionalText,
  dueDate: dateInput,
  status: ActionStatus.default('PENDING'),
  evidenceUrl,
  evidenceNotes: optionalText,
  completedAt: dateInput,
});

const ControlSchema = z.object({
  title: z.string().trim().min(1),
  category: z.string().trim().min(1),
  type: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  implementation: optionalText,
  monitoringFrequency: optionalText,
  ownerName: optionalText,
  parameters: z.record(z.unknown()).optional().nullable(),
  status: ControlStatus.default('DRAFT'),
  riskIds: z.array(z.string()).default([]),
  treatmentIds: z.array(z.string()).default([]),
});

const KpiSchema = z.object({
  name: z.string().trim().min(1),
  description: optionalText,
  metricType: KpiMetricType,
  unit: z.string().trim().min(1),
  frequency: KpiFrequency,
  targetValue: z.coerce.number(),
  warningValue: z.coerce.number().optional().nullable(),
  direction: KpiDirection.default('HIGHER_IS_BETTER'),
  assetId: optionalText,
  riskId: optionalText,
  controlId: optionalText,
  isActive: z.boolean().optional(),
});

const MeasurementSchema = z.object({
  measuredAt: z.string().datetime().or(z.string().date()),
  value: z.coerce.number(),
  notes: optionalText,
  source: z.string().trim().min(1).default('MANUAL'),
  evidenceUrl,
});

const CriteriaSchema = z.object({
  acceptanceThreshold: z.coerce.number().int().min(0).max(25),
});

@Injectable()
export class RiskOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  listAssets(search?: string) {
    return this.prisma.informationAsset.findMany({
      where: search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createAsset(user: AuthenticatedUser, body: unknown) {
    const data = AssetSchema.parse(body);
    try {
      return await this.prisma.informationAsset.create({
        data: {
          ...data,
          ownerUserId: user.id,
        },
      });
    } catch (error) {
      this.handleKnownError(error, 'Asset code already exists');
    }
  }

  updateAsset(id: string, body: unknown) {
    const data = AssetSchema.partial().parse(body);
    return this.prisma.informationAsset.update({
      where: { id },
      data: data,
    });
  }

  async removeAsset(id: string) {
    await this.prisma.informationAsset.update({
      where: { id },
      data: { isActive: false },
    });
    return { success: true };
  }

  listRisks() {
    return this.prisma.risk.findMany({
      include: { asset: true, treatments: true, controls: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  listUserOptions() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
      orderBy: { email: 'asc' },
    });
  }

  async listRiskAlerts() {
    const [assets, alerts] = await Promise.all([
      this.prisma.informationAsset.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          tags: true,
          criticality: true,
        },
      }),
      this.prisma.alertHistory.findMany({
        orderBy: [
          { sentAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        take: 200,
      }),
    ]);

    return alerts
      .map((alert) => {
        const payload = this.asPayloadObject(alert.payload);
        const sourceText = this.alertSourceText(alert, payload);
        const matchedAssets = assets
          .map((asset) => {
            const matchedTags = asset.tags.filter((tag) =>
              this.matchesAlertTag(sourceText, tag),
            );
            return matchedTags.length > 0 ? { ...asset, matchedTags } : null;
          })
          .filter(Boolean);

        if (matchedAssets.length === 0) return null;

        return {
          id: alert.id,
          incidentId: alert.incidentId,
          eventId: alert.eventId,
          sourceKey: alert.sourceKey ?? alert.serviceSource,
          serviceSource: alert.serviceSource,
          country: alert.country,
          victim: alert.victim,
          group: alert.group,
          severity: alert.severity,
          sentAt: alert.sentAt,
          createdAt: alert.createdAt,
          sourceMessage: this.alertSourceMessage(alert, payload),
          payload,
          matchedAssets,
        };
      })
      .filter(Boolean)
      .slice(0, 50);
  }

  async getRiskMatrix() {
    const [criteria, risks] = await Promise.all([
      this.getCriteria(),
      this.prisma.risk.findMany({
        where: { isActive: true },
        select: { id: true, likelihood: true, impact: true },
      }),
    ]);
    const cells = new Map<
      string,
      { probability: number; impact: number; count: number; riskIds: string[] }
    >();
    for (const risk of risks) {
      const key = `${risk.likelihood}-${risk.impact}`;
      const cell = cells.get(key) ?? {
        probability: risk.likelihood,
        impact: risk.impact,
        count: 0,
        riskIds: [],
      };
      cell.count += 1;
      cell.riskIds.push(risk.id);
      cells.set(key, cell);
    }
    return {
      matrixSize: criteria.matrixSize,
      acceptanceThreshold: criteria.acceptanceThreshold,
      cells: Array.from(cells.values()),
    };
  }

  async getCriteria() {
    const config = await this.ensureConfig();
    return {
      matrixSize: config.matrixSize,
      acceptanceThreshold: config.acceptanceThreshold,
      probability: this.defaultLevels('PROBABILITY'),
      impact: this.defaultLevels('IMPACT'),
    };
  }

  async updateCriteria(body: unknown) {
    const data = CriteriaSchema.parse(body);
    const current = await this.ensureConfig();
    const maxScore = current.matrixSize * current.matrixSize;
    if (data.acceptanceThreshold > maxScore) {
      throw new BadRequestException(
        `Acceptance threshold must be between 0 and ${maxScore}`,
      );
    }
    const config = await this.prisma.riskOperationsConfig.update({
      where: { key: 'default' },
      data: { acceptanceThreshold: data.acceptanceThreshold },
    });
    return {
      matrixSize: config.matrixSize,
      acceptanceThreshold: config.acceptanceThreshold,
    };
  }

  async createRisk(user: AuthenticatedUser, body: unknown) {
    const data = RiskSchema.parse(body);
    await this.ensureAsset(data.assetId);
    if (data.ownerUserId) await this.ensureUser(data.ownerUserId);
    const scores = this.riskScores(
      data.likelihood,
      data.impact,
      data.residualLikelihood,
      data.residualImpact,
    );
    return this.prisma.risk.create({
      data: {
        ...data,
        ...scores,
        ownerUserId: data.ownerUserId || user.id,
      },
      include: { asset: true, treatments: true, controls: true },
    });
  }

  async updateRisk(id: string, body: unknown) {
    const data = RiskSchema.partial().parse(body);
    if (data.assetId) await this.ensureAsset(data.assetId);
    if (data.ownerUserId) await this.ensureUser(data.ownerUserId);
    const current = await this.ensureRisk(id);
    const likelihood = data.likelihood ?? current.likelihood;
    const impact = data.impact ?? current.impact;
    const residualLikelihood =
      data.residualLikelihood ?? current.residualLikelihood;
    const residualImpact = data.residualImpact ?? current.residualImpact;
    return this.prisma.risk.update({
      where: { id },
      data: {
        ...data,
        ...this.riskScores(
          likelihood,
          impact,
          residualLikelihood,
          residualImpact,
        ),
      },
      include: { asset: true, treatments: true, controls: true },
    });
  }

  async removeRisk(id: string) {
    await this.prisma.risk.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  listTreatments() {
    return this.prisma.riskTreatment.findMany({
      include: {
        risk: { include: { asset: true } },
        actions: true,
        controls: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createTreatment(user: AuthenticatedUser, body: unknown) {
    const data = TreatmentSchema.parse(body);
    await this.ensureRisk(data.riskId);
    if (data.responsibleUserId)
      await this.ensureUser(data.responsibleUserId);
    const scores = this.residualScores(
      data.residualLikelihood,
      data.residualImpact,
    );
    return this.prisma.riskTreatment.create({
      data: {
        ...this.treatmentData(data),
        ...scores,
        responsibleUserId: data.responsibleUserId || user.id,
      } as Prisma.RiskTreatmentUncheckedCreateInput,
      include: {
        risk: { include: { asset: true } },
        actions: true,
        controls: true,
      },
    });
  }

  async updateTreatment(id: string, body: unknown) {
    const data = TreatmentSchema.partial().parse(body);
    if (data.riskId) await this.ensureRisk(data.riskId);
    if (data.responsibleUserId)
      await this.ensureUser(data.responsibleUserId);
    const current = await this.ensureTreatment(id);
    const residualLikelihood =
      data.residualLikelihood ?? current.residualLikelihood;
    const residualImpact = data.residualImpact ?? current.residualImpact;
    return this.prisma.riskTreatment.update({
      where: { id },
      data: {
        ...this.treatmentData(data),
        ...this.residualScores(residualLikelihood, residualImpact),
      },
      include: {
        risk: { include: { asset: true } },
        actions: true,
        controls: true,
      },
    });
  }

  async removeTreatment(id: string) {
    await this.prisma.riskTreatment.delete({ where: { id } });
    return { success: true };
  }

  async createAction(
    user: AuthenticatedUser,
    treatmentId: string,
    body: unknown,
  ) {
    await this.ensureTreatment(treatmentId);
    const data = ActionSchema.parse(body);
    return this.prisma.treatmentAction.create({
      data: {
        ...this.actionData(data),
        treatmentId,
        ownerUserId: user.id,
      } as Prisma.TreatmentActionUncheckedCreateInput,
    });
  }

  updateAction(id: string, body: unknown) {
    const data = ActionSchema.partial().parse(body);
    return this.prisma.treatmentAction.update({
      where: { id },
      data: this.actionData(data),
    });
  }

  async removeAction(id: string) {
    await this.prisma.treatmentAction.delete({ where: { id } });
    return { success: true };
  }

  listControls() {
    return this.prisma.operationalControl.findMany({
      include: { risks: true, treatments: true, kpis: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createControl(user: AuthenticatedUser, body: unknown) {
    const data = ControlSchema.parse(body);
    return this.prisma.operationalControl.create({
      data: {
        ...this.controlData(data),
        ownerUserId: user.id,
      } as Prisma.OperationalControlUncheckedCreateInput,
      include: { risks: true, treatments: true, kpis: true },
    });
  }

  updateControl(id: string, body: unknown) {
    const data = ControlSchema.partial().parse(body);
    return this.prisma.operationalControl.update({
      where: { id },
      data: this.controlData(data),
      include: { risks: true, treatments: true, kpis: true },
    });
  }

  async removeControl(id: string) {
    await this.prisma.operationalControl.delete({ where: { id } });
    return { success: true };
  }

  listKpis() {
    return this.prisma.kpi.findMany({
      include: {
        asset: true,
        risk: true,
        control: true,
        measurements: { orderBy: { measuredAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createKpi(body: unknown) {
    const data = KpiSchema.parse(body);
    await this.ensureKpiLinks(data.assetId, data.riskId, data.controlId);
    return this.prisma.kpi.create({
      data: data,
      include: { asset: true, risk: true, control: true, measurements: true },
    });
  }

  async updateKpi(id: string, body: unknown) {
    const data = KpiSchema.partial().parse(body);
    await this.ensureKpiLinks(data.assetId, data.riskId, data.controlId);
    return this.prisma.kpi.update({
      where: { id },
      data: data,
      include: {
        asset: true,
        risk: true,
        control: true,
        measurements: { orderBy: { measuredAt: 'desc' } },
      },
    });
  }

  async removeKpi(id: string) {
    await this.prisma.kpi.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  async createMeasurement(
    user: AuthenticatedUser,
    kpiId: string,
    body: unknown,
  ) {
    await this.ensureKpi(kpiId);
    const data = MeasurementSchema.parse(body);
    try {
      return await this.prisma.kpiMeasurement.create({
        data: {
          ...data,
          measuredAt: new Date(data.measuredAt),
          kpiId,
          createdBy: user.id,
        },
      });
    } catch (error) {
      this.handleKnownError(
        error,
        'A measurement already exists for that date',
      );
    }
  }

  private riskScores(
    likelihood: number,
    impact: number,
    residualLikelihood?: number | null,
    residualImpact?: number | null,
  ) {
    const inherentScore = likelihood * impact;
    return {
      inherentScore,
      inherentLevel: this.level(inherentScore),
      ...this.residualScores(residualLikelihood, residualImpact),
    };
  }

  private residualScores(likelihood?: number | null, impact?: number | null) {
    if (!likelihood || !impact)
      return { residualScore: null, residualLevel: null };
    const residualScore = likelihood * impact;
    return { residualScore, residualLevel: this.level(residualScore) };
  }

  private level(score: number): PrismaRiskLevel {
    if (score >= 20) return 'CRITICAL';
    if (score >= 12) return 'HIGH';
    if (score >= 6) return 'MEDIUM';
    return 'LOW';
  }

  private async ensureConfig() {
    return this.prisma.riskOperationsConfig.upsert({
      where: { key: 'default' },
      create: { key: 'default', matrixSize: 5, acceptanceThreshold: 10 },
      update: {},
    });
  }

  private defaultLevels(dimension: 'PROBABILITY' | 'IMPACT') {
    const labels =
      dimension === 'PROBABILITY'
        ? ['Rara', 'Improbable', 'Posible', 'Probable', 'Frecuente']
        : ['Menor', 'Moderado', 'Relevante', 'Severo', 'Crítico'];
    return labels.map((label, index) => ({
      id: `${dimension}-${index + 1}`,
      dimension,
      value: index + 1,
      label,
    }));
  }

  private treatmentData(
    data:
      | z.infer<typeof TreatmentSchema>
      | Partial<z.infer<typeof TreatmentSchema>>,
  ) {
    return {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : data.dueDate,
      acceptedAt: data.acceptedAt ? new Date(data.acceptedAt) : data.acceptedAt,
    };
  }

  private actionData(
    data: z.infer<typeof ActionSchema> | Partial<z.infer<typeof ActionSchema>>,
  ) {
    return {
      ...data,
      dueDate: data.dueDate ? new Date(data.dueDate) : data.dueDate,
      completedAt: data.completedAt
        ? new Date(data.completedAt)
        : data.completedAt,
    };
  }

  private controlData(
    data:
      | z.infer<typeof ControlSchema>
      | Partial<z.infer<typeof ControlSchema>>,
  ) {
    const { riskIds, treatmentIds, parameters, ...rest } = data;
    void riskIds;
    void treatmentIds;
    return {
      ...rest,
      parameters: parameters as Prisma.InputJsonValue | undefined,
    };
  }

  private async ensureAsset(id: string) {
    const asset = await this.prisma.informationAsset.findUnique({
      where: { id },
    });
    if (!asset) throw new NotFoundException('Asset not found');
  }

  private async ensureRisk(id: string) {
    const risk = await this.prisma.risk.findUnique({ where: { id } });
    if (!risk) throw new NotFoundException('Risk not found');
    return risk;
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }

  private asPayloadObject(payload: Prisma.JsonValue): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    return payload as Record<string, unknown>;
  }

  private alertSourceMessage(
    alert: {
      incidentId: string;
      victim: string;
      group: string;
      country: string;
      severity: string | null;
    },
    payload: Record<string, unknown>,
  ) {
    const telegramMessage = payload.telegramMessage;
    if (typeof telegramMessage === 'string' && telegramMessage.trim()) {
      return telegramMessage;
    }
    const content = payload.content;
    if (typeof content === 'string' && content.trim()) {
      return content;
    }
    const description = payload.description;
    if (typeof description === 'string' && description.trim()) {
      return description;
    }
    return [alert.victim, alert.group, alert.country, alert.severity]
      .filter(Boolean)
      .join(' · ');
  }

  private alertSourceText(
    alert: {
      incidentId: string;
      eventId: string | null;
      serviceSource: string;
      sourceKey: string | null;
      country: string;
      victim: string;
      group: string;
      severity: string | null;
    },
    payload: Record<string, unknown>,
  ) {
    return [
      alert.incidentId,
      alert.eventId,
      alert.serviceSource,
      alert.sourceKey,
      alert.country,
      alert.victim,
      alert.group,
      alert.severity,
      this.safeJson(payload),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  private matchesAlertTag(sourceText: string, tag: string) {
    const normalized = tag.trim().toLowerCase();
    return normalized.length > 0 && sourceText.includes(normalized);
  }

  private safeJson(value: unknown) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }

  private async ensureTreatment(id: string) {
    const treatment = await this.prisma.riskTreatment.findUnique({
      where: { id },
    });
    if (!treatment) throw new NotFoundException('Risk treatment not found');
    return treatment;
  }

  private async ensureKpi(id: string) {
    const kpi = await this.prisma.kpi.findUnique({ where: { id } });
    if (!kpi) throw new NotFoundException('KPI not found');
  }

  private async ensureKpiLinks(
    assetId?: string,
    riskId?: string,
    controlId?: string,
  ) {
    if (assetId) await this.ensureAsset(assetId);
    if (riskId) await this.ensureRisk(riskId);
    if (controlId) {
      const control = await this.prisma.operationalControl.findUnique({
        where: { id: controlId },
      });
      if (!control) throw new NotFoundException('Control not found');
    }
  }

  private handleKnownError(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
    throw error;
  }
}
