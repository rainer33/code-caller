import { IsEnum, IsIP, IsString, MinLength } from 'class-validator';
import { OsType } from '@prisma/client';

export class CreateServerDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEnum(OsType)
  osType: OsType;

  @IsIP()
  tailscaleIp: string;
}
