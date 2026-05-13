import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';

function toDateTime(value: Date | string | undefined): Date | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00.000Z');
  return new Date(s);
}

export interface CreateFakeNewsDto {
    title: string;
    origin: string;
    target?: string;
    identificatedDate?: Date;
    methods?: string;
    consequences?: string[];
    links?: string[];
}

export interface UpdateFakeNewsDto {
    title?: string;
    origin?: string;
    target?: string;
    identificatedDate?: Date;
    methods?: string;
    consequences?: string[];
    links?: string[];
}

@Injectable()
export class FakeNewsService {
    private readonly logger = new Logger(FakeNewsService.name);

    constructor(private readonly prisma: PrismaService) { }

    async create(data: CreateFakeNewsDto) {
        try {
            const fakeNews = await this.prisma.fakeNewsData.create({
                data: {
                    title: data.title,
                    origin: data.origin,
                    target: data.target,
                    identificatedDate: toDateTime(data.identificatedDate as Date | string | undefined),
                    methods: data.methods,
                    consequences: data.consequences || [],
                    links: data.links || [],
                },
            });

            return {
                success: true,
                data: fakeNews,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error creating fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async findAll() {
        try {
            const fakeNews = await this.prisma.fakeNewsData.findMany({
                orderBy: { createdAt: 'desc' },
            });

            return {
                success: true,
                data: fakeNews,
                count: fakeNews.length,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error fetching fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async findOne(id: string) {
        try {
            const fakeNews = await this.prisma.fakeNewsData.findUnique({
                where: { id },
            });

            if (!fakeNews) {
                return {
                    success: false,
                    error: 'Fake news not found',
                    timestamp: new Date(),
                };
            }

            return {
                success: true,
                data: fakeNews,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error fetching fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async update(id: string, data: UpdateFakeNewsDto) {
        try {
            const existingFakeNews = await this.prisma.fakeNewsData.findUnique({
                where: { id },
            });

            if (!existingFakeNews) {
                return {
                    success: false,
                    error: 'Fake news not found',
                    timestamp: new Date(),
                };
            }

            const identificatedDateNorm = data.identificatedDate !== undefined ? toDateTime(data.identificatedDate as Date | string) : undefined;
            const fakeNews = await this.prisma.fakeNewsData.update({
                where: { id },
                data: {
                    ...(data.title !== undefined && { title: data.title }),
                    ...(data.origin !== undefined && { origin: data.origin }),
                    ...(data.target !== undefined && { target: data.target }),
                    ...(identificatedDateNorm !== undefined && { identificatedDate: identificatedDateNorm }),
                    ...(data.methods !== undefined && { methods: data.methods }),
                    ...(data.consequences !== undefined && { consequences: data.consequences }),
                    ...(data.links !== undefined && { links: data.links }),
                },
            });

            return {
                success: true,
                data: fakeNews,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error updating fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async remove(id: string) {
        try {
            const existingFakeNews = await this.prisma.fakeNewsData.findUnique({
                where: { id },
            });

            if (!existingFakeNews) {
                return {
                    success: false,
                    error: 'Fake news not found',
                    timestamp: new Date(),
                };
            }

            await this.prisma.fakeNewsData.delete({
                where: { id },
            });

            return {
                success: true,
                message: 'Fake news deleted successfully',
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error deleting fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async search(query: string) {
        try {
            const fakeNews = await this.prisma.fakeNewsData.findMany({
                where: {
                    OR: [
                        { title: { contains: query, mode: 'insensitive' } },
                        { origin: { contains: query, mode: 'insensitive' } },
                        { target: { contains: query, mode: 'insensitive' } },
                        { methods: { contains: query, mode: 'insensitive' } },
                    ],
                },
                orderBy: { createdAt: 'desc' },
            });

            return {
                success: true,
                data: fakeNews,
                count: fakeNews.length,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error searching fake news:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }

    async findByTarget(target: string) {
        try {
            const fakeNews = await this.prisma.fakeNewsData.findMany({
                where: {
                    target: {
                        equals: target,
                        mode: 'insensitive',
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            return {
                success: true,
                data: fakeNews,
                count: fakeNews.length,
                timestamp: new Date(),
            };
        } catch (error: any) {
            this.logger.error('Error fetching fake news by target:', error.message);
            return {
                success: false,
                error: error.message,
                timestamp: new Date(),
            };
        }
    }
}
