import { Controller, Get, Post, Put, Delete, Body, Param, Query, Res } from '@nestjs/common';
import { ActorsService } from './actors.service';
import type { Response } from 'express';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';

@Controller('actors')
export class ActorsController {
  constructor(private readonly actorsService: ActorsService) { }

  @Post()
  @RequireWrite()
  async create(@Body() createDto: any) {
    return this.actorsService.create(createDto);
  }

  @Get()
  async findAll() {
    return this.actorsService.findAll();
  }

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }
    return this.actorsService.search(query);
  }

  @Get('country/:country')
  async findByCountry(@Param('country') country: string) {
    return this.actorsService.findByCountry(country);
  }

  @Get('hitos/search')
  async searchHitos(
    @Query('q') query: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: 'date' | 'target' | 'name',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 25;
    return this.actorsService.searchHitos({
      query: query ?? '',
      page: isNaN(pageNum) ? 1 : pageNum,
      limit: isNaN(limitNum) ? 25 : limitNum,
      sortBy: sortBy ?? 'date',
      sortOrder: sortOrder ?? 'desc',
    });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.actorsService.findOne(id);
  }

  @Get(':id/export/pdf')
async exportPdf(@Param('id') id: string, @Res() res: Response) {
  return this.actorsService.exportPdf(id, res);
}

@Get(':id/export/docx')
async exportDocx(@Param('id') id: string, @Res() res: Response) {
  return this.actorsService.exportDocx(id, res);
}

  @Put(':id')
  @RequireWrite()
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.actorsService.update(id, updateDto);
  }

  @Delete(':id')
  @RequireWrite()
  async remove(@Param('id') id: string) {
    return this.actorsService.remove(id);
  }

  @Put('hitos/:id')
  @RequireWrite()
  async updateHito(@Param('id') id: string, @Body() updateDto: any) {
    return this.actorsService.updateHito(id, updateDto);
  }

  @Delete('hitos/:id')
  @RequireWrite()
  async removeHito(@Param('id') id: string) {
    return this.actorsService.removeHito(id);
  }
}

