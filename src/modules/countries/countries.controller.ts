import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UploadedFile,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';
import { CountriesService } from './countries.service';

const ALLOWED_FILE_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
]);

@Controller('countries')
export class CountriesController {
  constructor(private readonly countriesService: CountriesService) {}

  @Get()
  getCountries() {
    return this.countriesService.getCountries();
  }

  @Post(':country/upload')
  @RequireWrite()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        const allowed = ALLOWED_FILE_EXTENSIONS.has(extension) && ALLOWED_MIME_TYPES.has(file.mimetype);
        cb(allowed ? null : new BadRequestException('Unsupported file type'), allowed);
      },
      storage: diskStorage({
        destination: './tmp',
        filename: (_, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
        },
      }),
    }),
  )
  uploadFile(
    @Param('country') country: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.countriesService.uploadFile(country, file);
  }

  @Get(':country/download')
  async downloadFile(
    @Param('country') country: string,
    @Res() res: Response,
  ) {
    const result = await this.countriesService.downloadFile(country);

    return res.download(
      result.absPath,
      result.file.fileName,
    );
  }

  @Delete(':country/file')
  @RequireWrite()
  deleteFile(
    @Param('country') country: string,
  ) {
    return this.countriesService.deleteFile(country);
  }
}
