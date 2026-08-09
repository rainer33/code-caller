// Inbound (Daemon -> Hub) socket event names, on the /daemon namespace.
export const DAEMON_INBOUND = {
  HEARTBEAT: 'daemon:heartbeat',
  TASK_STATUS_UPDATE: 'task:statusUpdate',
  TASK_LOG: 'task:log',
  TASK_RESULT: 'task:result',
  APPROVAL_REQUEST: 'approval:request',
} as const;

// Outbound (Hub -> Daemon) socket event names, on the /daemon namespace.
export const DAEMON_OUTBOUND = {
  TASK_SUBMIT: 'task:submit',
  TASK_CANCEL: 'task:cancel',
  APPROVAL_DECISION: 'approval:decision',
} as const;

// Outbound (Hub -> Mobile) socket event names, on the /app namespace.
export const APP_OUTBOUND = {
  TASK_UPDATED: 'task:updated',
  APPROVAL_PENDING: 'approval:pending',
  APPROVAL_RESOLVED: 'approval:resolved',
} as const;

// Internal process-local event names (EventEmitter2), used to decouple
// RealtimeModule from the domain modules (tasks/approvals/servers) that
// react to inbound daemon events. This avoids a module import cycle
// (tasks/approvals -> realtime -> tasks/approvals).
export const INTERNAL_EVENTS = {
  DAEMON_TASK_STATUS: 'daemon.task.status',
  DAEMON_TASK_LOG: 'daemon.task.log',
  DAEMON_TASK_RESULT: 'daemon.task.result',
  DAEMON_APPROVAL_REQUEST: 'daemon.approval.request',
} as const;

export interface DaemonTaskStatusPayload {
  taskId: string;
  status: 'RUNNING' | 'AWAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
}

export interface DaemonTaskLogPayload {
  taskId: string;
  chunk: string;
}

export interface DaemonTaskResultPayload {
  taskId: string;
  status: 'COMPLETED' | 'FAILED';
  result: unknown;
}

export interface DaemonApprovalRequestPayload {
  taskId: string;
  reason: string;
}
