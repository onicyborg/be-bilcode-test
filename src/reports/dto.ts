import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { PageQuery, PageResult } from '../common';

export enum Status {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
}
export enum Category {
  ORGANIC = 'ORGANIC',
  PLASTIC = 'PLASTIC',
  PAPER = 'PAPER',
  GLASS = 'GLASS',
  METAL = 'METAL',
  CARDBOARD = 'CARDBOARD',
  CLOTHES = 'CLOTHES',
  FOOTWEAR = 'FOOTWEAR',
  BATTERY = 'BATTERY',
  OTHER = 'OTHER',
}

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const coordinate = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

export class CreateReport {
  @ApiProperty({ minLength: 1, maxLength: 1000 })
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  description!: string;

  @ApiProperty({ minimum: -90, maximum: 90 })
  @Transform(coordinate)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @Transform(coordinate)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

export class UpdateReport extends PartialType(CreateReport, { skipNullProperties: false }) {}

export class ReportQuery extends PageQuery {
  @ApiPropertyOptional({ enum: Status })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Status)
  status?: Status;

  @ApiPropertyOptional({ enum: Category })
  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Category)
  category?: Category;
}

export class UpdateStatus {
  @ApiProperty({ enum: Status })
  @IsEnum(Status)
  status!: Status;

  @ApiPropertyOptional({ minLength: 1, maxLength: 500, description: 'Required when rejecting' })
  @ValidateIf((body, value) => body.status === Status.REJECTED || value !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  reason?: string;
}

export class Prediction {
  @ApiProperty({ enum: Category }) category!: Category;
  @ApiProperty({ minimum: 0, maximum: 1 }) confidence!: number;
  @ApiProperty() modelVersion!: string;
}

export class Report {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) reporterId!: string;
  @ApiProperty() description!: string;
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
  @ApiProperty() photoUrl!: string;
  @ApiProperty({ enum: Status }) status!: Status;
  @ApiProperty({ type: Prediction, nullable: true }) prediction!: Prediction | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class StatusEvent {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) changedById!: string;
  @ApiProperty({ enum: Status, nullable: true }) fromStatus!: Status | null;
  @ApiProperty({ enum: Status }) toStatus!: Status;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class ReportDetail extends Report {
  @ApiProperty({ type: [StatusEvent] }) statusHistory!: StatusEvent[];
}
export class ReportPage extends PageResult {
  @ApiProperty({ type: [Report] }) items!: Report[];
}
export class Stats {
  @ApiProperty() total!: number;
  @ApiProperty({ type: 'object', properties: {
    PENDING: { type: 'integer' }, IN_PROGRESS: { type: 'integer' },
    COMPLETED: { type: 'integer' }, REJECTED: { type: 'integer' },
  } }) byStatus!: Record<Status, number>;
}
