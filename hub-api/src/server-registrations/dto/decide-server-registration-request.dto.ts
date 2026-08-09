import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecideServerRegistrationRequestDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
