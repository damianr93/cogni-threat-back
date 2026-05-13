import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { FakeNewsService } from './fake-news.service';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';

@Controller('fake-news')
export class FakeNewsController {
  constructor(private readonly fakeNewsService: FakeNewsService) {}

  @Post()
  @RequireWrite()
  async create(@Body() createDto: any) {
    return this.fakeNewsService.create(createDto);
  }

  @Get()
  async findAll() {
    return this.fakeNewsService.findAll();
  }

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }
    return this.fakeNewsService.search(query);
  }

  @Get('target/:target')
  async findByTarget(@Param('target') target: string) {
    return this.fakeNewsService.findByTarget(target);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.fakeNewsService.findOne(id);
  }

  @Put(':id')
  @RequireWrite()
  async update(@Param('id') id: string, @Body() updateDto: any) {
    return this.fakeNewsService.update(id, updateDto);
  }

  @Delete(':id')
  @RequireWrite()
  async remove(@Param('id') id: string) {
    return this.fakeNewsService.remove(id);
  }
}

