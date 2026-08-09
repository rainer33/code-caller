import { BadRequestException, Injectable } from '@nestjs/common';
import { WorkerType } from '@prisma/client';
import { AIWorkerAdapter } from './interfaces/ai-worker-adapter.interface';
import { CodexAdapter } from './adapters/codex.adapter';

@Injectable()
export class WorkerRegistry {
  private readonly adapters: Map<WorkerType, AIWorkerAdapter>;

  constructor(codexAdapter: CodexAdapter) {
    this.adapters = new Map([[codexAdapter.workerType, codexAdapter]]);
  }

  get(workerType: WorkerType): AIWorkerAdapter {
    const adapter = this.adapters.get(workerType);
    if (!adapter) {
      throw new BadRequestException(`지원하지 않는 워커 타입입니다: ${workerType}`);
    }
    return adapter;
  }
}
