import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { ApiRequest } from './auth/auth.controller';
import { UserDto } from './auth/dto';

export type AuthenticatedRequest = ApiRequest & { user: UserDto };

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<ApiRequest>().user?.role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Admin access required' });
    }
    return true;
  }
}

export class PageQuery {
  @ApiPropertyOptional({ description: 'Search term', maxLength: 100 })
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  q?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PageResult {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
