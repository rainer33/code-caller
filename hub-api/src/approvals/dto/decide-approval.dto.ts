import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecideApprovalDto {
  @IsBoolean()
  approve: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
