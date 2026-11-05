import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class EmailDto {
  @ApiProperty({ example: 'user@example.test', maxLength: 254 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ format: 'password', minLength: 8, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(8, 128)
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty({ example: 'Demo User', minLength: 1, maxLength: 100 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 100)
  name!: string;
}

export class VerifyEmailDto extends EmailDto {
  @ApiProperty({ example: '012345', pattern: '^[0-9]{6}$', writeOnly: true })
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Refresh JWT terakhir yang diterbitkan', writeOnly: true })
  @IsString()
  @Length(1, 2048)
  refreshToken!: string;
}

export class UserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ADMIN', 'USER'] }) role!: 'ADMIN' | 'USER';
  @ApiProperty() isActive!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class TokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty({ type: UserDto }) user!: UserDto;
}

export class MessageDto {
  @ApiProperty() message!: string;
}

export class ErrorDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}
