import { newMessageId, type InnerMessageBody, type PayloadOf, type Project, type ToolName, type ToolResult } from '@pocket/protocol';

interface PendingCall {
  executorId: string;
  resolve: (r: ToolResult) => void;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ExecutorInfo {
  workspaces: string[];
  os: string;
  shell: string;
  projects?: Project[];
  capabilities?: string[];
}

export interface CallOptions {
  signal?: AbortSignal;
  onOutput?: PendingCall['onOutput'];
  timeoutMs?: number;
  /** Project folder the call is confined to. */
  root?: string;
}

/** The computer one session works on, resolved on every use so switching computers takes effect immediately. */
export interface ExecutorHandle {
  readonly id: string | undefined;
  readonly online: boolean;
  readonly info: ExecutorInfo | null;
  /** Project the session works in, if one was picked. */
  readonly root: string | undefined;
  call(name: ToolName, args: unknown, opts?: CallOptions): Promise<ToolResult>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Remote procedure calls from the brain to the paired executor computers over the encrypted link. */
export class ExecutorBridge {
  private readonly pending = new Map<string, PendingCall>();
  private readonly infos = new Map<string, ExecutorInfo>();

  constructor(
    private readonly deps: {
      executorIds: () => string[];
      isOnline: (deviceId: string) => boolean;
      send: (to: string, body: InnerMessageBody) => boolean;
    },
  ) {}

  online(id: string | undefined): boolean {
    return !!id && this.deps.isOnline(id);
  }

  info(id: string | undefined): ExecutorInfo | null {
    return (id && this.infos.get(id)) || null;
  }

  setInfo(id: string, info: ExecutorInfo): void {
    this.infos.set(id, info);
  }

  forget(id: string): void {
    this.infos.delete(id);
    this.failAll('The computer was removed.', id);
  }

  handle(resolveId: () => string | undefined, resolveRoot: () => string | undefined = () => undefined): ExecutorHandle {
    const bridge = this;
    return {
      get root() {
        return resolveRoot();
      },
      get id() {
        return resolveId();
      },
      get online() {
        return bridge.online(resolveId());
      },
      get info() {
        return bridge.info(resolveId());
      },
      call: (name, args, opts) => bridge.call(resolveId(), name, args, { root: resolveRoot(), ...opts }),
    };
  }

  async call(executorId: string | undefined, name: ToolName, args: unknown, opts: CallOptions = {}): Promise<ToolResult> {
    if (!executorId) return { content: 'No computer is paired. Add one from the phone.', isError: true };
    if (!this.deps.isOnline(executorId)) return { content: 'The computer is offline (VS Code is closed or the laptop is asleep).', isError: true };

    const callId = newMessageId();
    return new Promise<ToolResult>((resolve) => {
      const finish = (r: ToolResult) => {
        const p = this.pending.get(callId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(callId);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(r);
      };
      const onAbort = () => {
        this.deps.send(executorId, { type: 'tool.cancel', payload: { callId } });
        finish({ content: 'Cancelled.', isError: true });
      };
      const timer = setTimeout(() => {
        this.deps.send(executorId, { type: 'tool.cancel', payload: { callId } });
        finish({ content: 'The computer did not answer in time.', isError: true });
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      this.pending.set(callId, { executorId, resolve: finish, onOutput: opts.onOutput, timer });
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      if (!this.deps.send(executorId, { type: 'tool.call', payload: { callId, name, args, ...(opts.root ? { root: opts.root } : {}) } })) {
        finish({ content: 'Could not reach the computer.', isError: true });
      }
    });
  }

  handleResult(from: string, p: PayloadOf<'tool.result'>): void {
    const call = this.pending.get(p.callId);
    if (call?.executorId === from) call.resolve({ content: p.content, isError: p.isError });
  }

  handleOutput(from: string, p: PayloadOf<'tool.output'>): void {
    const call = this.pending.get(p.callId);
    if (call?.executorId === from) call.onOutput?.(p.chunk, p.stream);
  }

  /** A computer went away: fail its calls (or all calls) instead of waiting for timeouts. */
  failAll(reason: string, executorId?: string): void {
    for (const p of [...this.pending.values()]) if (!executorId || p.executorId === executorId) p.resolve({ content: reason, isError: true });
  }

  /** Stops work on the given computers, or on every paired one. */
  killAll(ids?: string[]): void {
    const targets = ids ?? this.deps.executorIds();
    for (const id of targets) this.deps.send(id, { type: 'control.kill', payload: { scope: 'all' } });
    if (ids) for (const id of ids) this.failAll('Stopped by kill switch.', id);
    else this.failAll('Stopped by kill switch.');
  }
}
