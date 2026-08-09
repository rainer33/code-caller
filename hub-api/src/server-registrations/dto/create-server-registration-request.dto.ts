import { IsEmail, IsEnum, IsIP, IsOptional, IsString, MinLength } from 'class-validator';
import { OsType } from '@prisma/client';

export class CreateServerRegistrationRequestDto {
  @IsEmail()
  ownerEmail: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(OsType)
  osType: OsType;

  @IsIP()
  tailscaleIp: string;

  @IsString()
  @MinLength(12)
  fingerprint: string;

  @IsOptional()
  @IsString()
  profileName?: string;
}
