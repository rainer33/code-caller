import { WorkerType } from '@prisma/client';

export interface TaskRequest {
  taskId: string;
  serverId: string;
  input: unknown;
}

export interface TaskHandle {
  taskId: string;
}

export interface TaskStatus {
  taskId: string;
  status: 'QUEUED' | 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

export interface TaskResult {
  taskId: string;
  result: unknown;
}

/**
 * Common interface every AI worker (Codex/Claude/Gemini) adapter implements.
 * Hub-side adapters do not execute work themselves — they dispatch to the
 * Agent Daemon over the realtime channel and read status/results back from
 * the DB, which the daemon keeps up to date via inbound socket events.
 */
export interface AIWorkerAdapter {
  readonly workerType: WorkerType;
  submitTask(task: TaskRequest): Promise<TaskHandle>;
  getStatus(handle: TaskHandle): Promise<TaskStatus>;
  getResult(handle: TaskHandle): Promise<TaskResult>;
  cancelTask(handle: TaskHandle): Promise<void>;
}
