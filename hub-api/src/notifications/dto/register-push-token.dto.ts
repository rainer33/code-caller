import { IsEnum, IsString, MinLength } from 'class-validator';
import { PushPlatform } from '@prisma/client';

export class RegisterPushTokenDto {
  @IsString()
  @MinLength(1)
  token: string;

  @IsEnum(PushPlatform)
  platform: PushPlatform;
}
