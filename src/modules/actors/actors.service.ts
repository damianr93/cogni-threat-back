import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, HeadingLevel } from 'docx';
import type { Response } from 'express';

export interface CreateActorDto {
  name: string;
  identificatedDate?: Date;
  subGroup?: boolean;
  description?: string;
  country?: string;
  descriptionMethods?: string;
  methods?: string[];
  aliases?: string[];
  hitos?: string[];
  hitosDatas?: HitoCreateDto[];
}

export interface UpdateActorDto {
  name?: string;
  identificatedDate?: Date;
  subGroup?: boolean;
  description?: string;
  country?: string;
  descriptionMethods?: string;
  methods?: string[];
  aliases?: string[];
  hitos?: string[];
  hitosDatas?: (HitoCreateDto & { id?: string })[];
}

export interface HitoCreateDto {
  date?: Date;
  description: string;
  target: string;
  actorId?: string;
  link?: string;
  links?: string[];
}

export interface HitoUpdateDto {
  date?: Date;
  description?: string;
  target?: string;
  actorId?: string;
  link?: string;
  links?: string[];
}

@Injectable()
export class ActorsService {
  private readonly logger = new Logger(ActorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateActorDto) {
    try {
      const actor = await this.prisma.actorsData.create({
        data: {
          name: data.name,
          identificatedDate: data.identificatedDate,
          subGroup: data.subGroup || false,
          description: data.description,
          country: data.country,
          descriptionMethods: data.descriptionMethods,
          methods: data.methods || [],
          aliases: data.aliases || [],
          hitos: data.hitos || [],
          hitosDatas: {
            create:
              data.hitosDatas?.map((h) => ({
                date: h.date || new Date(),
                description: h.description,
                target: h.target,
                link: h.link ?? h.links?.[0] ?? null,
                links: h.links ?? [],
              })) || [],
          },
        },
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
      });

      return {
        success: true,
        data: actor,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error creating actor:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async findAll() {
    try {
      const actors = await this.prisma.actorsData.findMany({
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        data: actors,
        count: actors.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error fetching actors:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async findOne(id: string) {
    try {
      const actor = await this.prisma.actorsData.findUnique({
        where: { id },
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
      });

      if (!actor) {
        return {
          success: false,
          error: 'Actor not found',
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        data: actor,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error fetching actor:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async update(id: string, data: UpdateActorDto) {
    try {
      const existingActor = await this.prisma.actorsData.findUnique({
        where: { id },
        include: { hitosDatas: true },
      });

      if (!existingActor) {
        return {
          success: false,
          error: 'Actor not found',
          timestamp: new Date(),
        };
      }

      let hitosDatasUpdate: any = undefined;
      if (data.hitosDatas) {
        const incomingIds = data.hitosDatas
          .filter((h) => h.id)
          .map((h) => h.id);
        const hitosToDelete = existingActor.hitosDatas
          .filter((h) => !incomingIds.includes(h.id))
          .map((h) => h.id);

        const newHitos = data.hitosDatas.filter((h) => !h.id);
        const existingHitos = data.hitosDatas.filter((h) => !!h.id);

        hitosDatasUpdate = {
          deleteMany: { id: { in: hitosToDelete } },
          ...(newHitos.length > 0 && {
            create: newHitos.map((h) => ({
              date: h.date || new Date(),
              description: h.description,
              target: h.target,
              link: h.link ?? h.links?.[0] ?? null,
              links: h.links ?? [],
            })),
          }),
          ...(existingHitos.length > 0 && {
            update: existingHitos.map((h) => ({
              where: { id: h.id! },
              data: {
                date: h.date,
                description: h.description,
                target: h.target,
                link: h.link ?? h.links?.[0] ?? null,
                links: h.links ?? [],
              },
            })),
          }),
        };
      }

      const actor = await this.prisma.actorsData.update({
        where: { id },
        data: {
          ...(data.name && { name: data.name }),
          ...(data.identificatedDate !== undefined && {
            identificatedDate: data.identificatedDate,
          }),
          ...(data.subGroup !== undefined && { subGroup: data.subGroup }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          ...(data.country !== undefined && { country: data.country }),
          ...(data.descriptionMethods !== undefined && {
            descriptionMethods: data.descriptionMethods,
          }),
          ...(data.methods !== undefined && { methods: data.methods }),
          ...(data.aliases !== undefined && { aliases: data.aliases }),
          ...(data.hitos !== undefined && { hitos: data.hitos }),
          ...(hitosDatasUpdate ? { hitosDatas: hitosDatasUpdate } : {}),
        },
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
      });

      return {
        success: true,
        data: actor,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error updating actor:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async remove(id: string) {
    try {
      const existingActor = await this.prisma.actorsData.findUnique({
        where: { id },
      });

      if (!existingActor) {
        return {
          success: false,
          error: 'Actor not found',
          timestamp: new Date(),
        };
      }

      await this.prisma.$transaction([
        this.prisma.hitosData.deleteMany({ where: { actorsDataId: id } }),
        this.prisma.actorsData.delete({ where: { id } }),
      ]);

      return {
        success: true,
        message: 'Actor deleted successfully',
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error deleting actor:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async search(query: string) {
    try {
      const actors = await this.prisma.actorsData.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { country: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        data: actors,
        count: actors.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error searching actors:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async findByCountry(country: string) {
    try {
      const actors = await this.prisma.actorsData.findMany({
        where: {
          country: {
            equals: country,
            mode: 'insensitive',
          },
        },
        include: { hitosDatas: { orderBy: { date: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        data: actors,
        count: actors.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error fetching actors by country:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async searchHitos(params: {
    query?: string;
    page?: number;
    limit?: number;
    sortBy?: 'date' | 'target' | 'name';
    sortOrder?: 'asc' | 'desc';
  }) {
    try {
      const page = Math.max(1, params.page ?? 1);
      const limit = Math.min(100, Math.max(1, params.limit ?? 25));
      const sortBy = params.sortBy ?? 'date';
      const sortOrder = params.sortOrder ?? 'desc';
      const q = (params.query ?? '').trim();

      const where = q
        ? {
            OR: [
              { description: { contains: q, mode: 'insensitive' as const } },
              { target: { contains: q, mode: 'insensitive' as const } },
              {
                carriedOutBy: {
                  name: { contains: q, mode: 'insensitive' as const },
                },
              },
            ],
          }
        : {};

      const orderBy =
        sortBy === 'name'
          ? { carriedOutBy: { name: sortOrder } }
          : { [sortBy]: sortOrder };

      const [hitos, total] = await Promise.all([
        this.prisma.hitosData.findMany({
          where,
          include: { carriedOutBy: true },
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.hitosData.count({ where }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        success: true,
        data: hitos,
        total,
        page,
        totalPages,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error searching hitos:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async updateHito(id: string, data: HitoUpdateDto) {
    try {
      const existingHito = await this.prisma.hitosData.findUnique({
        where: { id },
      });

      if (!existingHito) {
        return {
          success: false,
          error: 'Hito not found',
          timestamp: new Date(),
        };
      }

      const hito = await this.prisma.hitosData.update({
        where: { id },
        data: {
          ...(data.date !== undefined && { date: data.date }),
          ...(data.description !== undefined && {
            description: data.description,
          }),
          ...(data.target !== undefined && { target: data.target }),
          ...(data.link !== undefined && { link: data.link }),
          ...(data.links !== undefined && { links: data.links }),
          ...(data.actorId !== undefined && { actorsDataId: data.actorId }),
        },
      });

      return {
        success: true,
        data: hito,
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error updating hito:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  async exportPdf(id: string, res: Response) {
    const actor = await this.prisma.actorsData.findUnique({
      where: { id },
      include: {
        hitosDatas: {
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!actor) {
      throw new Error('Actor not found');
    }

    const doc = new PDFDocument();

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${actor.name}.pdf"`,
    );

    res.setHeader('Content-Type', 'application/pdf');

    doc.pipe(res);

    doc.fontSize(20).text(actor.name);

    doc.moveDown();

    doc.fontSize(12).text(`País: ${actor.country ?? '-'}`);
    doc.text(`Fecha identificación: ${actor.identificatedDate ?? '-'}`);

    doc.moveDown();

    doc.text(`Descripción:`);
    doc.text(actor.description ?? '-');

    doc.moveDown();

    doc.text(`Alias:`);
    doc.text(actor.aliases.join(', ') || '-');

    doc.moveDown();

    doc.text(`Métodos:`);
    doc.text(actor.methods.join(', ') || '-');

    doc.moveDown();

    doc.text(`Descripción de métodos:`);
    doc.text(actor.descriptionMethods ?? '-');

    doc.moveDown();
    doc.fontSize(16).text('Hitos');

    actor.hitosDatas.forEach((hito) => {
      doc.moveDown();
      doc.fontSize(12).text(`${hito.date?.toISOString().split('T')[0] ?? ''}`);

      doc.text(`Objetivo: ${hito.target}`);
      doc.text(`Descripción: ${hito.description}`);

      if (hito.link) {
        doc.text(`Link: ${hito.link}`);
      }
    });

    doc.end();
  }

  async exportDocx(id: string, res: Response) {
    const actor = await this.prisma.actorsData.findUnique({
      where: { id },
      include: {
        hitosDatas: {
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!actor) {
      throw new Error('Actor not found');
    }

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: actor.name,
              heading: HeadingLevel.HEADING_1,
            }),

            new Paragraph(`País: ${actor.country ?? '-'}`),
            new Paragraph(
              `Fecha identificación: ${
                actor.identificatedDate
                  ? actor.identificatedDate.toISOString().split('T')[0]
                  : '-'
              }`,
            ),

            new Paragraph(''),
            new Paragraph(`Descripción: ${actor.description ?? '-'}`),
            new Paragraph(`Alias: ${actor.aliases.join(', ') || '-'}`),
            new Paragraph(`Métodos: ${actor.methods.join(', ') || '-'}`),
            new Paragraph(
              `Descripción métodos: ${actor.descriptionMethods ?? '-'}`,
            ),

            ...actor.hitosDatas.flatMap((hito) => [
              new Paragraph(''),
              new Paragraph(
                `Hito - ${
                  hito.date ? hito.date.toISOString().split('T')[0] : ''
                }`,
              ),
              new Paragraph(`Objetivo: ${hito.target}`),
              new Paragraph(`Descripción: ${hito.description}`),
              new Paragraph(`Link: ${hito.link ?? '-'}`),
            ]),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${actor.name}.docx"`,
    );

    res.send(buffer);
  }

  async removeHito(id: string) {
    try {
      const existingHito = await this.prisma.hitosData.findUnique({
        where: { id },
      });

      if (!existingHito) {
        return {
          success: false,
          error: 'Hito not found',
          timestamp: new Date(),
        };
      }

      await this.prisma.hitosData.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Hito deleted successfully',
        timestamp: new Date(),
      };
    } catch (error: any) {
      this.logger.error('Error deleting hito:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }
}
