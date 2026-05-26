declare module "@ampcode/plugin" {
  export interface PluginAPI {
    configuration: PluginConfiguration<Record<string, unknown>>;
    experimental?: ExperimentalPluginAPI;
    logger: PluginLogger;
    on(
      event: "session.start",
      handler: (event: SessionStartEvent, ctx: PluginEventContext) => void | Promise<void>,
    ): Subscription;
    on(
      event: "tool.call",
      handler: (
        event: ToolCallEvent,
        ctx: PluginEventContext,
      ) => ToolCallResult | Promise<ToolCallResult>,
    ): Subscription;
    on(
      event: "agent.start",
      handler: (
        event: AgentStartEvent,
        ctx: PluginEventContext,
      ) => AgentStartResult | Promise<AgentStartResult>,
    ): Subscription;
    on(
      event: "agent.end",
      handler: (
        event: AgentEndEvent,
        ctx: PluginEventContext,
      ) => AgentEndResult | Promise<AgentEndResult>,
    ): Subscription;
    registerCommand(
      id: string,
      options: PluginCommandOptions,
      handler: (ctx: PluginCommandContext) => void | Promise<void>,
    ): Subscription;
    registerTool(definition: PluginToolDefinition): Subscription;
  }

  export interface PluginLogger {
    log: (...args: Array<unknown>) => void;
  }

  export interface Subscription {
    unsubscribe(): void;
  }

  export interface ExperimentalPluginAPI {
    activeThread: Observable<{ id: string } | null> & {
      readonly current: { id: string } | null;
    };
    createStatusItem(initial?: StatusItemValue): StatusItem;
  }

  export interface Observable<T> {
    subscribe(onNext: (value: T) => void): Subscription;
  }

  export interface StatusItem extends Subscription {
    update(value: StatusItemValue): void;
  }

  export interface StatusItemValue {
    text: string;
    url?: string;
  }

  export interface PluginConfiguration<T> {
    get(): Promise<T>;
    update(partial: Partial<T>, target?: "workspace" | "global"): Promise<void>;
  }

  export interface PluginCommandOptions {
    category?: string;
    description?: string;
    title: string;
  }

  export interface PluginCommandContext {
    thread?: PluginThread;
    ui: PluginUI;
  }

  export interface PluginEventContext {
    ui: PluginUI;
  }

  export interface PluginUI {
    confirm(options: PluginConfirmOptions): Promise<boolean>;
    input(options: PluginInputOptions): Promise<string | undefined>;
    notify(message: string): Promise<void>;
    select(options: PluginSelectOptions): Promise<string | undefined>;
  }

  export interface PluginInputOptions {
    helpText?: string;
    initialValue?: string;
    submitButtonText?: string;
    title?: string;
  }

  export interface PluginConfirmOptions {
    confirmButtonText?: string;
    message?: string;
    title: string;
  }

  export interface PluginSelectOptions {
    initialValue?: string;
    message?: string;
    options: Array<string>;
    title: string;
  }

  export interface PluginThread {
    append(messages: Array<UserMessage>): Promise<void>;
    id: string;
  }

  export interface UserMessage {
    content: string;
    type: "user-message";
  }

  export interface ToolCallEvent {
    input: Record<string, unknown>;
    thread: { id: string };
    tool: string;
    toolUseID: string;
  }

  export interface SessionStartEvent {
    thread: { id: string };
  }

  export type ToolCallResult =
    | { action: "allow" }
    | { action: "reject-and-continue"; message: string }
    | { action: "modify"; input: Record<string, unknown> }
    | { action: "synthesize"; result: { exitCode?: number; output: string } }
    | { action: "error"; message: string };

  export interface AgentStartEvent {
    id: string | number;
    message: string;
    thread: { id: string };
  }

  export interface AgentStartResult {
    message?: { content: string; display?: boolean };
  }

  export interface AgentEndEvent {
    id: string | number;
    message: string;
    messages: Array<unknown>;
    status: "done" | "error" | "cancelled";
    thread: { id: string };
  }

  export type AgentEndResult = { action: "continue"; userMessage: string } | void;

  export interface PluginToolDefinition {
    description: string;
    execute(input: Record<string, unknown>, ctx: PluginToolContext): Promise<string | void>;
    inputSchema: {
      [key: string]: unknown;
      properties?: Record<string, object>;
      required?: Array<string>;
      type: "object";
    };
    name: string;
  }

  export interface PluginToolContext {
    logger: PluginLogger;
    ui: PluginUI;
  }
}
