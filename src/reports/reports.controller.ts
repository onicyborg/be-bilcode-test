import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccessGuard, Document } from '../auth/auth.controller';
import { AdminGuard, AuthenticatedRequest } from '../common';
import { CreateReport, Report, ReportDetail, ReportPage, ReportQuery, Stats, UpdateReport, UpdateStatus } from './dto';
import { ReportsService } from './reports.service';

const uuid = new ParseUUIDPipe({ version: '7' });
const authErrors = { 401: 'Valid access JWT required' };
const lookupErrors = { ...authErrors, 400: 'Invalid UUIDv7', 404: 'Report not found' };

@ApiTags('Reports')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, parts: 5 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['photo', 'description', 'latitude', 'longitude'], properties: {
    photo: { type: 'string', format: 'binary', description: 'JPEG or PNG, up to 5 MiB' },
    description: { type: 'string', minLength: 1, maxLength: 1000 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
  } } })
  @Document('Create a pending report and classify its photo', 201, Report, {
    ...authErrors, 400: 'Invalid report data', 413: 'Photo too large', 415: 'Invalid image format',
  })
  create(@Body() body: CreateReport, @UploadedFile() photo: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    return this.service.create(body, photo, req);
  }

  @Get()
  @Document('Search and filter reports visible to the current user', 200, ReportPage, { ...authErrors, 400: 'Invalid filters' })
  list(@Query() query: ReportQuery, @Req() req: AuthenticatedRequest) {
    return this.service.list(query, req);
  }

  @Get(':id')
  @Document('Get a report and its status history', 200, ReportDetail, lookupErrors)
  detail(@Param('id', uuid) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(id, req);
  }

  @Get(':id/photo')
  @Header('Cache-Control', 'private, no-store')
  @ApiProduces('image/jpeg')
  @Document('Download a photo with owner or admin access', 200, undefined, lookupErrors)
  @ApiResponse({ status: 200, description: 'Report photo', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } } })
  async photo(@Param('id', uuid) id: string, @Req() req: AuthenticatedRequest) {
    return new StreamableFile(await this.service.photo(id, req), { type: 'image/jpeg' });
  }

  @Patch(':id')
  @Document('Edit a pending report', 200, Report, { ...lookupErrors, 400: 'Invalid UUID or request body', 409: 'Report is no longer pending' })
  update(@Param('id', uuid) id: string, @Body() body: UpdateReport, @Req() req: AuthenticatedRequest) {
    return this.service.update(id, body, req);
  }

  @Delete(':id')
  @HttpCode(204)
  @Document('Soft delete a pending report', 204, undefined, { ...lookupErrors, 409: 'Report is no longer pending' })
  remove(@Param('id', uuid) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.remove(id, req);
  }

  @Patch(':id/status')
  @UseGuards(AdminGuard)
  @Document('Change a report status as an admin', 200, Report, {
    ...lookupErrors, 400: 'Invalid UUID or status payload', 403: 'Admin required', 409: 'Invalid transition',
  })
  changeStatus(@Param('id', uuid) id: string, @Body() body: UpdateStatus, @Req() req: AuthenticatedRequest) {
    return this.service.changeStatus(id, body, req);
  }
}

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(AccessGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: ReportsService) {}

  @Get('stats')
  @Document('Count visible reports by status', 200, Stats, authErrors)
  stats(@Req() req: AuthenticatedRequest) {
    return this.service.stats(req);
  }
}
