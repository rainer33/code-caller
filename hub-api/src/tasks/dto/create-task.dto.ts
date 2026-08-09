import { IsEnum, IsNotEmptyObject, IsUUID } from 'class-validator';
import { WorkerType } from '@prisma/client';

export class CreateTaskDto {
  @IsUUID()
  serverId: string;

  @IsEnum(WorkerType)
  workerType: WorkerType;

  @IsNotEmptyObject()
  input: Record<string, unknown>;
}
