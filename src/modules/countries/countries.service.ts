import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { StorageService } from '../../shared/storage/storage.service';
import countries from '../../../libs/utils/countries';
import * as fs from 'fs';

@Injectable()
export class CountriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

async getCountries() {
  const actors = await this.prisma.actorsData.findMany({
    select: { country: true },
  });

  const countryFiles = await this.prisma.countryFile.findMany();

  const fileMap = Object.fromEntries(
    countryFiles.map((file) => [file.countryCode, file]),
  );

  const actorCounts = actors.reduce((acc, actor) => {
    if (!actor.country?.trim()) return acc;

    const country = actor.country.trim();
    acc[country] = (acc[country] || 0) + 1;

    return acc;
  }, {} as Record<string, number>);

  const countryNameMap: Record<string, string> = {
    China: 'China',
    'Corea del Norte': 'Korea, North',
    Rusia: 'Russia',
    Irán: 'Iran',
    Israel: 'Israel',
    Pakistán: 'Pakistan',
    India: 'India',
    Ucrania: 'Ukraine',
  };

  const data = Object.entries(actorCounts)
    .filter(([name]) =>
      ![
        '',
        'No identificado',
        'No identificado ',
        'No identificado (ASIA)',
        'Prorruso',
      ].includes(name),
    )
    .map(([name, count]) => {
      const englishName = countryNameMap[name] || name;

      const countryInfo = countries.find(
        c => c.name.toLowerCase() === englishName.toLowerCase(),
      );

      const countryCode = countryInfo?.code2 ?? '';

      return {
        name,
        code2: countryCode,
        actorCount: count,
        fileName: fileMap[countryCode]?.fileName ?? null,
      };
    });

  return {
    success: true,
    data,
    count: data.length,
    timestamp: new Date(),
  };
}

async uploadFile(country: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const countryCode = this.normalizeCountryCode(country);

    const existing = await this.prisma.countryFile.findUnique({
      where: { countryCode },
    });

    if (existing?.filePath) {
      const oldPath = this.storageService.resolveAbsPath(existing.filePath);

      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const filePath = await this.storageService.moveFile(
      file.path,
      'countries',
      countryCode,
      file.filename,
    );

    const document = await this.prisma.countryFile.upsert({
      where: { countryCode },
      update: {
        fileName: file.originalname,
        filePath,
      },
      create: {
        countryCode,
        countryName: this.countryName(countryCode),
        fileName: file.originalname,
        filePath,
      },
    });

    return {
      success: true,
      data: document,
    };
}
  async downloadFile(country: string) {
    const countryCode = this.normalizeCountryCode(country);
    const file = await this.prisma.countryFile.findUnique({
      where: { countryCode },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    const absPath = this.storageService.resolveAbsPath(file.filePath);

    if (!fs.existsSync(absPath)) {
      throw new BadRequestException('File missing on disk');
    }

    return {
        file,
        absPath,
        };
  }

  async deleteFile(country: string) {
    const countryCode = this.normalizeCountryCode(country);
    const file = await this.prisma.countryFile.findUnique({
      where: { countryCode },
    });

    if (!file) {
      throw new BadRequestException('File not found');
    }

    const absPath = this.storageService.resolveAbsPath(file.filePath);

    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }

    await this.prisma.countryFile.delete({
      where: { countryCode },
    });

    return {
      success: true,
      country: countryCode,
    };
  }

  private normalizeCountryCode(country: string) {
    const code = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code) || !countries.some((item) => item.code2 === code)) {
      throw new BadRequestException('Invalid country code');
    }
    return code;
  }

  private countryName(countryCode: string) {
    return countries.find((item) => item.code2 === countryCode)?.name ?? countryCode;
  }
}
