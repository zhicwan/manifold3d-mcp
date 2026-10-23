/**
 * The DeepSeek Harness (DSH) surface this Extension uses, described
 * structurally. DSH loads plain JavaScript plugins and ships no type package
 * for them, so the Host entry adapts its Cordis context to these interfaces
 * and tests supply mocks. Only fields the composition actually reads appear.
 */

export interface DshTextBlock {
  type: 'text';
  text: string;
}

/** An image admitted through the DSH attachment store. */
export interface DshImageBlock {
  type: 'image';
  attachment: unknown;
}

export type DshContentBlock = DshTextBlock | DshImageBlock;

export interface DshSession {
  readonly id: string;
}

export interface DshInboxMessage {
  content: DshTextBlock[];
  source: { kind: string };
}

/** A live Agent. `followup` queues an ordinary next-turn input and wakes it. */
export interface DshAgent {
  readonly session: DshSession;
  followup(message: DshInboxMessage): unknown;
}

export interface DshToolExecution {
  readonly agent?: DshAgent;
  readonly signal: AbortSignal;
}

export interface DshToolResult {
  readonly isError?: boolean;
  readonly value?: unknown;
  readonly content?: readonly DshContentBlock[];
}

/** The raw DSH tool definition (what `defineTool` would produce). */
export interface DshToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: Record<string, unknown>;
    render(args: unknown, value: unknown): DshContentBlock[];
  };
  projectContent?(exec: DshToolExecution, result: DshToolResult): DshContentBlock[] | undefined;
  execute(args: unknown, exec: DshToolExecution): Promise<unknown>;
}

/** One route on the authenticated DSH connection fetch channel. */
export interface DshFetchRoute {
  path: string;
  methods: readonly string[];
  requestBody: 'buffered';
  fetch(request: Request): Promise<Response>;
}

/** Host capabilities resolved by the entry from the Cordis context. */
export interface DshHostPorts {
  /** The live Agent for a Session id, if the Session is active. */
  getAgent(sessionId: string): DshAgent | undefined;
  /** The Session's effective working directory. */
  workingDirectory(agent: DshAgent): string;
  /** Record an unexpected failure in the Harness log without exposing it to clients. */
  reportError(message: string, error: unknown): void;
  /** Whether non-owner peers may reach the connection channel. */
  allowsRemoteAuthorities(): boolean;
  /**
   * Admit a PNG into durable model context when the current model accepts
   * images. Returns the reason when the image cannot be admitted.
   */
  admitImage(exec: DshToolExecution, png: Uint8Array): Promise<{ block: DshImageBlock } | { unavailable: string }>;
}
