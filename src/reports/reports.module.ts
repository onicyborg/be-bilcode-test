import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard } from '../common';
import { PhotoService } from './photo.service';
import { PurgeService } from './purge.service';
import { DashboardController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService, PhotoService, PurgeService, AdminGuard],
})
export class ReportsModule {}
