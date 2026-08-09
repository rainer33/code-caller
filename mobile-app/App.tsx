import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getMessaging,
  getToken,
  requestPermission,
} from '@react-native-firebase/messaging';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';

const API_BASE_URL = 'http://172.30.1.83:3000';
const REFRESH_TOKEN_KEY = 'codeCaller.refreshToken';

type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

type ServerItem = {
  id: string;
  name: string;
  osType: string;
  tailscaleIp: string;
  status: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
};

type TaskItem = {
  id: string;
  serverId: string;
  workerType: string;
  status: string;
  input: unknown;
  result?: unknown;
  logs?: string;
  createdAt: string;
  updatedAt?: string;
};

type ApprovalItem = {
  id: string;
  taskId: string;
  status: string;
  reason?: string | null;
  requestedAt: string;
  decidedAt?: string | null;
  task?: TaskItem;
};

type WorkerType = 'CODEX' | 'CLAUDE' | 'GEMINI';

type Tab = 'servers' | 'newTask' | 'tasks' | 'approvals';

const WORKER_TYPES: WorkerType[] = ['CODEX', 'CLAUDE', 'GEMINI'];

const TABS: Array<{
  key: Tab;
  label: string;
  icon: string;
  count?: 'servers' | 'tasks' | 'approvals';
}> = [
  { key: 'servers', label: 'Servers', icon: 'S', count: 'servers' },
  { key: 'newTask', label: 'New', icon: '+' },
  { key: 'tasks', label: 'Tasks', icon: 'T', count: 'tasks' },
  { key: 'approvals', label: 'Approvals', icon: 'A', count: 'approvals' },
];

const colors = {
  bg: '#f3f6fa',
  surface: '#ffffff',
  surfaceAlt: '#eef3f8',
  border: '#d9e1ea',
  text: '#111827',
  textSoft: '#4b5563',
  muted: '#6b7280',
  mutedLight: '#9ca3af',
  primary: '#1d4ed8',
  primarySoft: '#dbeafe',
  success: '#15803d',
  successSoft: '#dcfce7',
  warning: '#b45309',
  warningSoft: '#fef3c7',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
  offline: '#64748b',
  offlineSoft: '#e2e8f0',
  dark: '#111827',
};

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function formatDate(value?: string | null) {
  if (!value) {
    return '기록 없음';
  }
  const date = new Date(value);
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value?: string | null) {
  if (!value) {
    return '기록 없음';
  }
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) {
    return '방금 전';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}시간 전`;
  }
  return formatDate(value);
}

function summarize(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractPrompt(input: unknown) {
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    'prompt' in input
  ) {
    const promptValue = (input as { prompt?: unknown }).prompt;
    return summarize(promptValue);
  }
  return summarize(input);
}

function compactId(value?: string | null) {
  if (!value) {
    return 'n/a';
  }
  if (value.length <= 14) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function normalizeStatus(value: string) {
  const status = value.toUpperCase();
  if (status.includes('CONNECTED')) {
    return {
      label: 'Connected',
      tone: 'success' as const,
    };
  }
  if (status.includes('ONLINE')) {
    return {
      label: 'Online',
      tone: 'success' as const,
    };
  }
  if (status.includes('RUNNING') || status.includes('QUEUED')) {
    return {
      label: status.includes('QUEUED') ? '대기 중' : '실행 중',
      tone: 'info' as const,
    };
  }
  if (status.includes('AWAITING_APPROVAL') || status.includes('PENDING')) {
    return {
      label: status.includes('PENDING') ? '승인 대기' : '승인 대기',
      tone: 'warning' as const,
    };
  }
  if (status.includes('COMPLETED') || status.includes('APPROVED')) {
    return {
      label: status.includes('APPROVED') ? '승인됨' : '완료',
      tone: 'success' as const,
    };
  }
  if (status.includes('FAILED') || status.includes('ERROR')) {
    return {
      label: '실패',
      tone: 'danger' as const,
    };
  }
  if (
    status.includes('OFFLINE') ||
    status.includes('DISCONNECTED') ||
    status.includes('CANCELLED') ||
    status.includes('REJECTED')
  ) {
    return {
      label: status.includes('REJECTED')
        ? '거절됨'
        : status.includes('CANCELLED')
        ? '취소됨'
        : 'Offline',
      tone: 'neutral' as const,
    };
  }
  return {
    label: value,
    tone: 'neutral' as const,
  };
}

function pushSummary(pushState: string) {
  if (pushState.startsWith('registered')) {
    return {
      title: '푸시 알림 켜짐',
      detail: pushState.replace('registered ', '토큰 '),
      tone: 'success' as const,
    };
  }
  if (pushState.includes('requesting')) {
    return {
      title: '푸시 알림 등록 중',
      detail: '기기 토큰을 확인하고 있습니다.',
      tone: 'info' as const,
    };
  }
  if (pushState.includes('unavailable')) {
    return {
      title: '알림을 사용할 수 없음',
      detail: 'Firebase 설정을 확인한 뒤 다시 시도하세요.',
      tone: 'warning' as const,
    };
  }
  return {
    title: '푸시 알림 꺼짐',
    detail: '승인 요청 알림을 받으려면 등록하세요.',
    tone: 'neutral' as const,
  };
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CodeCallerApp />
    </SafeAreaProvider>
  );
}

function CodeCallerApp() {
  const insets = useSafeAreaInsets();
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('servers');
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [workerType, setWorkerType] = useState<WorkerType>('CODEX');
  const [prompt, setPrompt] = useState('');
  const [socketState, setSocketState] = useState('offline');
  const [pushState, setPushState] = useState('not registered');
  const socketRef = useRef<Socket | null>(null);

  const saveTokens = useCallback(async (nextTokens: AuthTokens | null) => {
    setTokens(nextTokens);
    if (nextTokens) {
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, nextTokens.refreshToken);
    } else {
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }, []);

  const refreshSession = useCallback(
    async (refreshToken: string) => {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        throw new Error(`refresh failed (${response.status})`);
      }
      const nextTokens = (await parseJson(response)) as AuthTokens;
      await saveTokens(nextTokens);
      return nextTokens;
    },
    [saveTokens],
  );

  const request = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      if (!tokens) {
        throw new Error('not authenticated');
      }
      const run = (accessToken: string) =>
        fetch(`${API_BASE_URL}${path}`, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(options.headers ?? {}),
          },
        });

      let response = await run(tokens.accessToken);
      if (response.status === 401) {
        const refreshed = await refreshSession(tokens.refreshToken);
        response = await run(refreshed.accessToken);
      }
      if (!response.ok) {
        const body = await parseJson(response).catch(() => null);
        throw new Error(
          `${path} failed (${response.status}) ${summarize(body)}`.trim(),
        );
      }
      return (await parseJson(response)) as T;
    },
    [refreshSession, tokens],
  );

  const loadAll = useCallback(async () => {
    if (!tokens) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [serverData, taskData, approvalData] = await Promise.all([
        request<ServerItem[]>('/servers'),
        request<TaskItem[]>('/tasks'),
        request<ApprovalItem[]>('/approvals?status=PENDING'),
      ]);
      setServers(serverData);
      setSelectedServerId(current => {
        if (current && serverData.some(server => server.id === current)) {
          return current;
        }
        return (
          serverData.find(server => server.name === 'MacBook-Local')?.id ??
          serverData[0]?.id ??
          null
        );
      });
      setTasks(taskData);
      setApprovals(approvalData);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [request, tokens]);

  const login = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!response.ok) {
        throw new Error(`login failed (${response.status})`);
      }
      const nextTokens = (await parseJson(response)) as AuthTokens;
      await saveTokens(nextTokens);
      setPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [email, password, saveTokens]);

  const logout = useCallback(async () => {
    const refreshToken = tokens?.refreshToken;
    await saveTokens(null);
    setServers([]);
    setTasks([]);
    setApprovals([]);
    setSelectedServerId(null);
    setPrompt('');
    if (refreshToken) {
      fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
  }, [saveTokens, tokens?.refreshToken]);

  const decideApproval = useCallback(
    async (approval: ApprovalItem, approve: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await request<ApprovalItem>(`/approvals/${approval.id}/decision`, {
          method: 'POST',
          body: JSON.stringify({
            approve,
            reason: approve
              ? 'Approved from Android app'
              : 'Rejected from Android app',
          }),
        });
        await loadAll();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [loadAll, request],
  );

  const createTask = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!selectedServerId || !trimmedPrompt) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const task = await request<TaskItem>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          serverId: selectedServerId,
          workerType,
          input: { prompt: trimmedPrompt },
        }),
      });
      setTasks(current => [
        task,
        ...current.filter(item => item.id !== task.id),
      ]);
      setPrompt('');
      setWorkerType('CODEX');
      setTab('tasks');
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [loadAll, prompt, request, selectedServerId, workerType]);

  const registerPushToken = useCallback(async () => {
    if (!tokens) {
      return;
    }
    setPushState('requesting token');
    setError(null);
    try {
      const firebaseMessaging = getMessaging();
      await requestPermission(firebaseMessaging);
      const token = await getToken(firebaseMessaging);
      await request('/notifications/push-token', {
        method: 'POST',
        body: JSON.stringify({ token, platform: 'ANDROID' }),
      });
      setPushState(`registered ${token.slice(0, 12)}...`);
    } catch (err) {
      const message = (err as Error).message;
      setPushState('registration unavailable');
      setError(`FCM registration failed: ${message}`);
    }
  }, [request, tokens]);

  useEffect(() => {
    AsyncStorage.getItem(REFRESH_TOKEN_KEY)
      .then(storedRefreshToken => {
        if (!storedRefreshToken) {
          return null;
        }
        return refreshSession(storedRefreshToken);
      })
      .catch(() => AsyncStorage.removeItem(REFRESH_TOKEN_KEY))
      .finally(() => setBooting(false));
  }, [refreshSession]);

  useEffect(() => {
    if (!tokens) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketState('offline');
      return;
    }

    loadAll();
    const socket = io(`${API_BASE_URL}/app`, {
      transports: ['websocket'],
      auth: { token: tokens.accessToken },
    });
    socketRef.current = socket;
    socket.on('connect', () => setSocketState('connected'));
    socket.on('disconnect', () => setSocketState('offline'));
    socket.on('connect_error', err => setSocketState(`error: ${err.message}`));
    socket.on('task:updated', (task: TaskItem) => {
      setTasks(current => {
        const without = current.filter(item => item.id !== task.id);
        return [task, ...without];
      });
    });
    socket.on('approval:pending', (approval: ApprovalItem) => {
      setApprovals(current => {
        const without = current.filter(item => item.id !== approval.id);
        return [approval, ...without];
      });
      setTab('approvals');
    });
    socket.on('approval:resolved', (approval: ApprovalItem) => {
      setApprovals(current =>
        current.map(item => (item.id === approval.id ? approval : item)),
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [loadAll, tokens]);

  const content = useMemo(() => {
    if (tab === 'servers') {
      return (
        <ServersList
          onSelectedServerChange={setSelectedServerId}
          selectedServerId={selectedServerId}
          servers={servers}
        />
      );
    }
    if (tab === 'newTask') {
      return (
        <NewTaskScreen
          busy={busy}
          onPromptChange={setPrompt}
          onSelectedServerChange={setSelectedServerId}
          onSubmit={createTask}
          onWorkerTypeChange={setWorkerType}
          prompt={prompt}
          selectedServerId={selectedServerId}
          servers={servers}
          workerType={workerType}
        />
      );
    }
    if (tab === 'tasks') {
      return <TasksList tasks={tasks} />;
    }
    return <ApprovalsList approvals={approvals} onDecision={decideApproval} />;
  }, [
    approvals,
    busy,
    createTask,
    decideApproval,
    prompt,
    selectedServerId,
    servers,
    tab,
    tasks,
    workerType,
  ]);

  if (booting) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>세션을 복원하는 중</Text>
      </SafeAreaView>
    );
  }

  if (!tokens) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.loginPane}
        >
          <Text style={styles.loginTitle}>Code Caller</Text>
          <Text style={styles.loginSubtitle}>Hub API: {API_BASE_URL}</Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            style={styles.input}
            value={email}
          />
          <TextInput
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <PrimaryButton
            disabled={busy || !email || !password}
            label="Login"
            onPress={login}
          />
          {busy ? <ActivityIndicator style={styles.inlineSpinner} /> : null}
          {error ? <ErrorBanner message={error} /> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  const socket = normalizeStatus(socketState);
  const push = pushSummary(pushState);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.title}>Code Caller</Text>
          <View style={styles.connectionRow}>
            <View
              style={[
                styles.statusDot,
                socket.tone === 'success'
                  ? styles.statusDotSuccess
                  : socket.tone === 'danger'
                  ? styles.statusDotDanger
                  : styles.statusDotWarning,
              ]}
            />
            <Text style={styles.connectionText}>{socket.label}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            disabled={busy}
            onPress={loadAll}
            style={styles.iconButton}
          >
            <Text style={styles.iconButtonText}>{busy ? '...' : 'R'}</Text>
          </Pressable>
          <Pressable onPress={logout} style={styles.logoutButton}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.pushCard}>
        <View style={styles.pushTextGroup}>
          <Text style={styles.pushTitle}>{push.title}</Text>
          <Text style={styles.pushDetail} numberOfLines={1}>
            {push.detail}
          </Text>
        </View>
        <Pressable onPress={registerPushToken} style={styles.smallButton}>
          <Text style={styles.smallButtonText}>등록</Text>
        </Pressable>
      </View>

      {error ? <ErrorBanner message={error} /> : null}
      {busy ? <ActivityIndicator style={styles.inlineSpinner} /> : null}
      <View style={styles.content}>{content}</View>
      <BottomNavigation
        activeTab={tab}
        approvalsCount={approvals.length}
        bottomInset={insets.bottom}
        onChange={setTab}
        serversCount={servers.length}
        tasksCount={tasks.length}
      />
    </SafeAreaView>
  );
}

function NewTaskScreen({
  busy,
  onPromptChange,
  onSelectedServerChange,
  onSubmit,
  onWorkerTypeChange,
  prompt,
  selectedServerId,
  servers,
  workerType,
}: {
  busy: boolean;
  onPromptChange: (value: string) => void;
  onSelectedServerChange: (value: string) => void;
  onSubmit: () => void;
  onWorkerTypeChange: (value: WorkerType) => void;
  prompt: string;
  selectedServerId: string | null;
  servers: ServerItem[];
  workerType: WorkerType;
}) {
  const canSubmit = Boolean(selectedServerId && prompt.trim()) && !busy;
  const selectedServer = servers.find(server => server.id === selectedServerId);
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollToPrompt = useCallback(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, []);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeading
          subtitle="실행할 서버와 작업 내용을 순서대로 선택하세요."
          title="새 작업"
        />
        <Text style={styles.sectionLabel}>1. 실행 서버</Text>
        {servers.length === 0 ? (
          <EmptyState label="서버를 불러온 뒤 작업을 만들 수 있습니다." />
        ) : (
          servers.map(server => (
            <Pressable
              key={server.id}
              onPress={() => onSelectedServerChange(server.id)}
              style={[
                styles.optionButton,
                selectedServerId === server.id && styles.optionButtonActive,
              ]}
            >
              <View style={styles.optionMain}>
                <Text
                  style={[
                    styles.optionTitle,
                    selectedServerId === server.id && styles.optionTitleActive,
                  ]}
                >
                  {server.name}
                </Text>
                <Text
                  style={[
                    styles.optionMeta,
                    selectedServerId === server.id && styles.optionMetaActive,
                  ]}
                >
                  {server.osType} / {server.tailscaleIp}
                </Text>
              </View>
              <View style={styles.optionRight}>
                {selectedServerId === server.id ? (
                  <Text style={styles.selectedMark}>Selected</Text>
                ) : null}
                <StatusPill label={server.status} />
              </View>
            </Pressable>
          ))
        )}

        <Text style={styles.sectionLabel}>2. AI Worker</Text>
        <View style={styles.segmentRow}>
          {WORKER_TYPES.map(item => (
            <Pressable
              key={item}
              onPress={() => onWorkerTypeChange(item)}
              style={[
                styles.segmentButton,
                workerType === item && styles.segmentButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  workerType === item && styles.segmentTextActive,
                ]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.promptHeader}>
          <Text style={styles.sectionLabel}>3. 작업 내용</Text>
          <Text style={styles.counterText}>{prompt.length}자</Text>
        </View>
        {selectedServer ? (
          <Text style={styles.helperText}>
            선택됨: {selectedServer.name} / {selectedServer.osType}
          </Text>
        ) : null}
        <TextInput
          multiline
          onContentSizeChange={scrollToPrompt}
          onChangeText={onPromptChange}
          onFocus={scrollToPrompt}
          placeholder="선택한 서버에서 Codex에게 시킬 일을 입력하세요."
          placeholderTextColor={colors.mutedLight}
          style={[styles.input, styles.promptInput]}
          textAlignVertical="top"
          value={prompt}
        />
        <PrimaryButton
          disabled={!canSubmit}
          label={busy ? '전송 중' : '작업 실행'}
          onPress={onSubmit}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ServersList({
  onSelectedServerChange,
  selectedServerId,
  servers,
}: {
  onSelectedServerChange: (value: string) => void;
  selectedServerId: string | null;
  servers: ServerItem[];
}) {
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={servers}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <ScreenHeading
          subtitle="작업을 실행할 수 있는 워커 서버 상태입니다."
          title="서버"
        />
      }
      ListEmptyComponent={<EmptyState label="등록된 서버가 없습니다." />}
      renderItem={({ item }) => (
        <Pressable
          onPress={() => onSelectedServerChange(item.id)}
          style={[
            styles.card,
            selectedServerId === item.id && styles.selectedCard,
          ]}
        >
          <View style={styles.row}>
            <View style={styles.cardTitleGroup}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.meta}>
                {item.osType} / {item.tailscaleIp}
              </Text>
            </View>
            <StatusPill label={item.status} />
          </View>
          <Text style={styles.footerMeta}>
            마지막 연결 {formatRelativeTime(item.lastHeartbeatAt)}
            {selectedServerId === item.id ? ' / 기본 실행 대상' : ''}
          </Text>
        </Pressable>
      )}
    />
  );
}

function TasksList({ tasks }: { tasks: TaskItem[] }) {
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={tasks}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <ScreenHeading
          subtitle="최근 작업의 상태와 마지막 로그를 확인하세요."
          title="작업"
        />
      }
      ListEmptyComponent={<EmptyState label="아직 생성된 작업이 없습니다." />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.workerType}
            </Text>
            <StatusPill label={item.status} />
          </View>
          <InfoBlock
            label="프롬프트"
            lines={2}
            value={extractPrompt(item.input) || '입력 내용 없음'}
          />
          {item.logs ? (
            <InfoBlock label="최근 로그" lines={3} value={item.logs} />
          ) : null}
          {item.result ? (
            <InfoBlock label="결과" lines={3} value={summarize(item.result)} />
          ) : null}
          <View style={styles.metaGrid}>
            <Text style={styles.footerMeta}>Task {compactId(item.id)}</Text>
            <Text style={styles.footerMeta}>
              Server {compactId(item.serverId)}
            </Text>
            <Text style={styles.footerMeta}>
              요청 {formatDate(item.createdAt)}
            </Text>
          </View>
        </View>
      )}
    />
  );
}

function ApprovalsList({
  approvals,
  onDecision,
}: {
  approvals: ApprovalItem[];
  onDecision: (approval: ApprovalItem, approve: boolean) => void;
}) {
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={approvals.filter(item => item.status === 'PENDING')}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <ScreenHeading
          subtitle="대기 중인 승인 요청을 검토하고 결정하세요."
          title="승인"
        />
      }
      ListEmptyComponent={
        <EmptyState label="대기 중인 승인 요청이 없습니다." />
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              승인 요청
            </Text>
            <StatusPill label={item.status} />
          </View>
          <View style={styles.approvalContext}>
            <Text style={styles.footerMeta}>
              Task {compactId(item.taskId)} / 요청{' '}
              {formatDate(item.requestedAt)}
            </Text>
            {item.task ? (
              <Text style={styles.footerMeta}>
                {item.task.workerType} / Server {compactId(item.task.serverId)}
              </Text>
            ) : null}
          </View>
          <InfoBlock
            label="요청 내용"
            lines={3}
            value={item.reason || '승인 요청 사유가 없습니다.'}
          />
          <View style={styles.actionRow}>
            <PrimaryButton
              label="승인"
              onPress={() => onDecision(item, true)}
            />
            <DangerButton
              label="거절"
              onPress={() => {
                Alert.alert(
                  '승인 요청을 거절할까요?',
                  item.reason || item.taskId,
                  [
                    { text: '취소', style: 'cancel' },
                    {
                      text: '거절',
                      style: 'destructive',
                      onPress: () => onDecision(item, false),
                    },
                  ],
                );
              }}
            />
          </View>
        </View>
      )}
    />
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{label}</Text>
      <Text style={styles.emptyText}>
        새로고침하거나 다른 화면에서 작업을 생성하세요.
      </Text>
    </View>
  );
}

function StatusPill({ label }: { label: string }) {
  const status = normalizeStatus(label);
  return (
    <View
      style={[
        styles.pill,
        status.tone === 'success' && styles.pillSuccess,
        status.tone === 'warning' && styles.pillWarning,
        status.tone === 'danger' && styles.pillDanger,
        status.tone === 'info' && styles.pillInfo,
        status.tone === 'neutral' && styles.pillNeutral,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          status.tone === 'success' && styles.pillTextSuccess,
          status.tone === 'warning' && styles.pillTextWarning,
          status.tone === 'danger' && styles.pillTextDanger,
          status.tone === 'info' && styles.pillTextInfo,
          status.tone === 'neutral' && styles.pillTextNeutral,
        ]}
      >
        {status.label}
      </Text>
    </View>
  );
}

function ScreenHeading({
  subtitle,
  title,
}: {
  subtitle: string;
  title: string;
}) {
  return (
    <View style={styles.screenHeading}>
      <Text style={styles.screenTitle}>{title}</Text>
      <Text style={styles.screenSubtitle}>{subtitle}</Text>
    </View>
  );
}

function InfoBlock({
  label,
  lines,
  value,
}: {
  label: string;
  lines: number;
  value: string;
}) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={lines}>
        {value}
      </Text>
    </View>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <View style={styles.errorTextGroup}>
        <Text style={styles.errorTitle}>요청을 처리하지 못했습니다</Text>
        <Text style={styles.errorDetail} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
}

function BottomNavigation({
  activeTab,
  approvalsCount,
  bottomInset,
  onChange,
  serversCount,
  tasksCount,
}: {
  activeTab: Tab;
  approvalsCount: number;
  bottomInset: number;
  onChange: (tab: Tab) => void;
  serversCount: number;
  tasksCount: number;
}) {
  const counts = {
    servers: serversCount,
    tasks: tasksCount,
    approvals: approvalsCount,
  };

  return (
    <View
      style={[
        styles.bottomNav,
        {
          paddingBottom: Math.max(bottomInset, 34),
        },
      ]}
    >
      {TABS.map(item => {
        const active = activeTab === item.key;
        const count = item.count ? counts[item.count] : undefined;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.navItem, active && styles.navItemActive]}
          >
            <View style={styles.navIconWrap}>
              <Text style={[styles.navIcon, active && styles.navIconActive]}>
                {item.icon}
              </Text>
              {typeof count === 'number' && count > 0 ? (
                <View style={styles.navBadge}>
                  <Text style={styles.navBadgeText}>
                    {count > 99 ? '99+' : count}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PrimaryButton({
  disabled,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.primaryButton, disabled && styles.disabled]}
    >
      <Text style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function DangerButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.dangerButton}>
      <Text style={styles.dangerButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flex: 1,
    justifyContent: 'center',
  },
  loginPane: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loginTitle: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0,
  },
  loginSubtitle: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 13,
    marginBottom: 18,
    marginTop: 6,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },
  connectionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  statusDotSuccess: {
    backgroundColor: colors.success,
  },
  statusDotWarning: {
    backgroundColor: colors.warning,
  },
  statusDotDanger: {
    backgroundColor: colors.danger,
  },
  connectionText: {
    color: colors.textSoft,
    fontFamily: 'sans-serif',
    fontSize: 12,
    fontWeight: '700',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconButtonText: {
    color: colors.primary,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '900',
  },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  logoutButtonText: {
    color: colors.textSoft,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '800',
  },
  pushCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pushTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  pushTitle: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '800',
  },
  pushDetail: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 12,
    marginTop: 2,
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  smallButtonText: {
    color: colors.primary,
    fontFamily: 'sans-serif',
    fontSize: 12,
    fontWeight: '900',
  },
  content: {
    flex: 1,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 15,
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: colors.surface,
    fontFamily: 'sans-serif',
    fontSize: 15,
    fontWeight: '800',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
  },
  dangerButtonText: {
    color: colors.surface,
    fontFamily: 'sans-serif',
    fontSize: 15,
    fontWeight: '800',
  },
  disabled: {
    backgroundColor: '#93c5fd',
    opacity: 1,
  },
  inlineSpinner: {
    marginTop: 8,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#fecaca',
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
  },
  errorTextGroup: {
    gap: 2,
  },
  errorTitle: {
    color: colors.danger,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '900',
  },
  errorDetail: {
    color: colors.danger,
    fontFamily: 'sans-serif',
    fontSize: 12,
    lineHeight: 17,
  },
  list: {
    gap: 12,
    padding: 16,
    paddingBottom: 148,
  },
  form: {
    gap: 12,
    padding: 16,
    paddingBottom: 152,
  },
  screenHeading: {
    marginBottom: 2,
  },
  screenTitle: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 20,
    fontWeight: '900',
  },
  screenSubtitle: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  sectionLabel: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    shadowColor: colors.dark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  selectedCard: {
    backgroundColor: '#f8fbff',
    borderColor: colors.primary,
    borderWidth: 2,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    flex: 1,
    fontFamily: 'sans-serif',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  meta: {
    color: colors.textSoft,
    fontFamily: 'sans-serif',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  footerMeta: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  metaGrid: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 2,
  },
  infoBlock: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 8,
    marginTop: 12,
    padding: 12,
  },
  infoLabel: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 4,
  },
  infoValue: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 14,
    lineHeight: 20,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    minHeight: 64,
    padding: 12,
  },
  optionButtonActive: {
    backgroundColor: '#f8fbff',
    borderColor: colors.primary,
    borderWidth: 2,
  },
  optionMain: {
    flex: 1,
    minWidth: 0,
  },
  optionRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  selectedMark: {
    color: colors.primary,
    fontFamily: 'sans-serif',
    fontSize: 11,
    fontWeight: '900',
  },
  optionTitle: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 15,
    fontWeight: '900',
  },
  optionTitleActive: {
    color: colors.text,
  },
  optionMeta: {
    color: colors.textSoft,
    fontFamily: 'sans-serif',
    fontSize: 12,
    marginTop: 4,
  },
  optionMetaActive: {
    color: colors.textSoft,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    color: colors.textSoft,
    fontFamily: 'sans-serif',
    fontSize: 13,
    fontWeight: '900',
  },
  segmentTextActive: {
    color: colors.surface,
  },
  promptHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  counterText: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 12,
    fontWeight: '700',
  },
  helperText: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 12,
    marginTop: -4,
  },
  promptInput: {
    minHeight: 132,
  },
  pill: {
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillSuccess: {
    backgroundColor: colors.successSoft,
  },
  pillWarning: {
    backgroundColor: colors.warningSoft,
  },
  pillDanger: {
    backgroundColor: colors.dangerSoft,
  },
  pillInfo: {
    backgroundColor: colors.primarySoft,
  },
  pillNeutral: {
    backgroundColor: colors.offlineSoft,
  },
  pillText: {
    fontFamily: 'sans-serif',
    fontSize: 11,
    fontWeight: '900',
  },
  pillTextSuccess: {
    color: colors.success,
  },
  pillTextWarning: {
    color: colors.warning,
  },
  pillTextDanger: {
    color: colors.danger,
  },
  pillTextInfo: {
    color: colors.primary,
  },
  pillTextNeutral: {
    color: colors.offline,
  },
  approvalContext: {
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 20,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: 'sans-serif',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptyText: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },
  bottomNav: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: 'absolute',
    right: 0,
  },
  navItem: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    gap: 3,
    minHeight: 52,
    justifyContent: 'center',
  },
  navItemActive: {
    backgroundColor: colors.primarySoft,
  },
  navIconWrap: {
    minHeight: 22,
    minWidth: 28,
  },
  navIcon: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'center',
  },
  navIconActive: {
    color: colors.primary,
  },
  navLabel: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    fontSize: 11,
    fontWeight: '800',
  },
  navLabelActive: {
    color: colors.primary,
  },
  navBadge: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 999,
    minWidth: 17,
    paddingHorizontal: 4,
    position: 'absolute',
    right: -6,
    top: -4,
  },
  navBadgeText: {
    color: colors.surface,
    fontFamily: 'sans-serif',
    fontSize: 10,
    fontWeight: '900',
  },
  muted: {
    color: colors.muted,
    fontFamily: 'sans-serif',
    marginTop: 12,
  },
});
