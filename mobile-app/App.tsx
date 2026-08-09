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
import { SafeAreaView } from 'react-native-safe-area-context';
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

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function formatDate(value?: string | null) {
  if (!value) {
    return 'n/a';
  }
  return new Date(value).toLocaleString();
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

export default function App() {
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
      return <ServersList servers={servers} />;
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
        <Text style={styles.muted}>Restoring session</Text>
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
          <Text style={styles.title}>Code Caller</Text>
          <Text style={styles.subtitle}>Hub API: {API_BASE_URL}</Text>
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
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Code Caller</Text>
          <Text style={styles.subtitle}>Socket: {socketState}</Text>
        </View>
        <Pressable onPress={logout} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <TabButton
          active={tab === 'servers'}
          label={`Servers (${servers.length})`}
          onPress={() => setTab('servers')}
        />
        <TabButton
          active={tab === 'newTask'}
          label="New Task"
          onPress={() => setTab('newTask')}
        />
        <TabButton
          active={tab === 'tasks'}
          label={`Tasks (${tasks.length})`}
          onPress={() => setTab('tasks')}
        />
        <TabButton
          active={tab === 'approvals'}
          label={`Approvals (${approvals.length})`}
          onPress={() => setTab('approvals')}
        />
      </View>

      <View style={styles.toolbar}>
        <Pressable
          disabled={busy}
          onPress={loadAll}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </Pressable>
        <Pressable onPress={registerPushToken} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Register FCM</Text>
        </Pressable>
      </View>
      <Text style={styles.pushState}>Push: {pushState}</Text>
      {busy ? <ActivityIndicator style={styles.inlineSpinner} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {content}
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

  return (
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.sectionLabel}>Target server</Text>
      {servers.length === 0 ? (
        <EmptyState label="Refresh servers before creating a task" />
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
            <StatusPill label={server.status} />
          </Pressable>
        ))
      )}

      <Text style={styles.sectionLabel}>Worker</Text>
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

      <Text style={styles.sectionLabel}>Prompt</Text>
      <TextInput
        multiline
        onChangeText={onPromptChange}
        placeholder="Ask Codex what to do on the selected server"
        style={[styles.input, styles.promptInput]}
        textAlignVertical="top"
        value={prompt}
      />
      <PrimaryButton
        disabled={!canSubmit}
        label={busy ? 'Submitting' : 'Dispatch Task'}
        onPress={onSubmit}
      />
    </ScrollView>
  );
}

function ServersList({ servers }: { servers: ServerItem[] }) {
  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={servers}
      keyExtractor={item => item.id}
      ListEmptyComponent={<EmptyState label="No servers returned by Hub API" />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{item.name}</Text>
            <StatusPill label={item.status} />
          </View>
          <Text style={styles.meta}>
            {item.osType} / {item.tailscaleIp}
          </Text>
          <Text style={styles.meta}>
            Last heartbeat: {formatDate(item.lastHeartbeatAt)}
          </Text>
        </View>
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
      ListEmptyComponent={<EmptyState label="No tasks returned by Hub API" />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{item.workerType}</Text>
            <StatusPill label={item.status} />
          </View>
          <Text style={styles.meta}>Task: {item.id}</Text>
          <Text style={styles.meta}>Server: {item.serverId}</Text>
          <Text style={styles.bodyText} numberOfLines={3}>
            Input: {summarize(item.input)}
          </Text>
          {item.logs ? (
            <Text style={styles.bodyText} numberOfLines={4}>
              Logs: {item.logs}
            </Text>
          ) : null}
          {item.result ? (
            <Text style={styles.bodyText} numberOfLines={4}>
              Result: {summarize(item.result)}
            </Text>
          ) : null}
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
      ListEmptyComponent={<EmptyState label="No pending approvals" />}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>Approval</Text>
            <StatusPill label={item.status} />
          </View>
          <Text style={styles.meta}>Task: {item.taskId}</Text>
          <Text style={styles.meta}>
            Requested: {formatDate(item.requestedAt)}
          </Text>
          <ScrollView style={styles.reasonBox}>
            <Text style={styles.bodyText}>
              {item.reason || 'No reason supplied'}
            </Text>
          </ScrollView>
          <View style={styles.actionRow}>
            <PrimaryButton
              label="Approve"
              onPress={() => onDecision(item, true)}
            />
            <DangerButton
              label="Reject"
              onPress={() => {
                Alert.alert('Reject approval?', item.reason || item.taskId, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Reject',
                    style: 'destructive',
                    onPress: () => onDecision(item, false),
                  },
                ]);
              }}
            />
          </View>
        </View>
      )}
    />
  );
}

function EmptyState({ label }: { label: string }) {
  return <Text style={styles.empty}>{label}</Text>;
}

function StatusPill({ label }: { label: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label}
      </Text>
    </Pressable>
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
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  center: {
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
    flex: 1,
    justifyContent: 'center',
  },
  loginPane: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  title: {
    color: '#151a21',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#687385',
    fontSize: 13,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d5dbe5',
    borderRadius: 8,
    borderWidth: 1,
    color: '#151a21',
    fontSize: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1769e0',
    borderRadius: 8,
    flex: 1,
    marginTop: 16,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#cbd3df',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    color: '#263243',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#c62f3a',
    borderRadius: 8,
    flex: 1,
    marginTop: 16,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dangerButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  inlineSpinner: {
    marginTop: 12,
  },
  error: {
    color: '#b2232f',
    fontSize: 13,
    marginHorizontal: 16,
    marginTop: 10,
  },
  tabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
  },
  tabButton: {
    alignItems: 'center',
    backgroundColor: '#e9edf3',
    borderRadius: 8,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#151a21',
  },
  tabText: {
    color: '#4f5d70',
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  toolbar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  pushState: {
    color: '#687385',
    fontSize: 12,
    marginHorizontal: 16,
    marginTop: 8,
  },
  list: {
    gap: 12,
    padding: 16,
    paddingBottom: 36,
  },
  form: {
    gap: 12,
    padding: 16,
    paddingBottom: 36,
  },
  sectionLabel: {
    color: '#263243',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dde3ec',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    color: '#151a21',
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
  },
  meta: {
    color: '#687385',
    fontSize: 12,
    marginTop: 6,
  },
  bodyText: {
    color: '#263243',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  optionButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d5dbe5',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 68,
    padding: 12,
  },
  optionButtonActive: {
    backgroundColor: '#151a21',
    borderColor: '#151a21',
  },
  optionMain: {
    flex: 1,
  },
  optionTitle: {
    color: '#151a21',
    fontSize: 15,
    fontWeight: '800',
  },
  optionTitleActive: {
    color: '#ffffff',
  },
  optionMeta: {
    color: '#687385',
    fontSize: 12,
    marginTop: 4,
  },
  optionMetaActive: {
    color: '#cbd3df',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    alignItems: 'center',
    backgroundColor: '#e9edf3',
    borderRadius: 8,
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#1769e0',
  },
  segmentText: {
    color: '#4f5d70',
    fontSize: 13,
    fontWeight: '800',
  },
  segmentTextActive: {
    color: '#ffffff',
  },
  promptInput: {
    minHeight: 140,
  },
  pill: {
    backgroundColor: '#e7f0ff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillText: {
    color: '#1769e0',
    fontSize: 11,
    fontWeight: '800',
  },
  reasonBox: {
    backgroundColor: '#f5f7fa',
    borderRadius: 8,
    marginTop: 10,
    maxHeight: 120,
    padding: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  empty: {
    color: '#687385',
    fontSize: 15,
    padding: 24,
    textAlign: 'center',
  },
  muted: {
    color: '#687385',
    marginTop: 12,
  },
});
