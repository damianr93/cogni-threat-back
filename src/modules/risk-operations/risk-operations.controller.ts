import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { RiskOperationsService } from './risk-operations.service';

@Controller('risk-operations')
export class RiskOperationsController {
  constructor(private readonly service: RiskOperationsService) {}

  @Get('assets')
  listAssets(@Query('search') search?: string) {
    return this.service.listAssets(search);
  }

  @Post('assets')
  @RequireWrite()
  createAsset(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createAsset(user, body);
  }

  @Put('assets/:id')
  @RequireWrite()
  updateAsset(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateAsset(id, body);
  }

  @Delete('assets/:id')
  @RequireWrite()
  removeAsset(@Param('id') id: string) {
    return this.service.removeAsset(id);
  }

  @Get('risks')
  listRisks() {
    return this.service.listRisks();
  }

  @Get('risks/matrix')
  getRiskMatrix() {
    return this.service.getRiskMatrix();
  }

  @Get('criteria')
  getCriteria() {
    return this.service.getCriteria();
  }

  @Put('criteria')
  @RequireWrite()
  updateCriteria(@Body() body: unknown) {
    return this.service.updateCriteria(body);
  }

  @Post('risks')
  @RequireWrite()
  createRisk(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createRisk(user, body);
  }

  @Put('risks/:id')
  @RequireWrite()
  updateRisk(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateRisk(id, body);
  }

  @Delete('risks/:id')
  @RequireWrite()
  removeRisk(@Param('id') id: string) {
    return this.service.removeRisk(id);
  }

  @Get('treatments')
  listTreatments() {
    return this.service.listTreatments();
  }

  @Post('treatments')
  @RequireWrite()
  createTreatment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.service.createTreatment(user, body);
  }

  @Put('treatments/:id')
  @RequireWrite()
  updateTreatment(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateTreatment(id, body);
  }

  @Delete('treatments/:id')
  @RequireWrite()
  removeTreatment(@Param('id') id: string) {
    return this.service.removeTreatment(id);
  }

  @Post('treatments/:id/actions')
  @RequireWrite()
  createAction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') treatmentId: string,
    @Body() body: unknown,
  ) {
    return this.service.createAction(user, treatmentId, body);
  }

  @Put('actions/:id')
  @RequireWrite()
  updateAction(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateAction(id, body);
  }

  @Delete('actions/:id')
  @RequireWrite()
  removeAction(@Param('id') id: string) {
    return this.service.removeAction(id);
  }

  @Get('controls')
  listControls() {
    return this.service.listControls();
  }

  @Post('controls')
  @RequireWrite()
  createControl(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.createControl(user, body);
  }

  @Put('controls/:id')
  @RequireWrite()
  updateControl(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateControl(id, body);
  }

  @Delete('controls/:id')
  @RequireWrite()
  removeControl(@Param('id') id: string) {
    return this.service.removeControl(id);
  }

  @Get('kpis')
  listKpis() {
    return this.service.listKpis();
  }

  @Post('kpis')
  @RequireWrite()
  createKpi(@Body() body: unknown) {
    return this.service.createKpi(body);
  }

  @Put('kpis/:id')
  @RequireWrite()
  updateKpi(@Param('id') id: string, @Body() body: unknown) {
    return this.service.updateKpi(id, body);
  }

  @Delete('kpis/:id')
  @RequireWrite()
  removeKpi(@Param('id') id: string) {
    return this.service.removeKpi(id);
  }

  @Post('kpis/:id/measurements')
  @RequireWrite()
  createMeasurement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') kpiId: string,
    @Body() body: unknown,
  ) {
    return this.service.createMeasurement(user, kpiId, body);
  }
}
