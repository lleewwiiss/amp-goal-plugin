import { describe, expect, test } from "bun:test";
import type {
  Agent,
  AgentStartEvent,
  AgentStartResult,
  Observable,
  PluginAPI,
  PluginCommandContext,
  PluginEventContext,
  PluginEventMap,
  PluginSelectOptions,
  PluginThread,
  PluginToolContext,
  PluginToolDefinition,
  Subscription,
  ThreadID,
} from "@ampcode/plugin";
import goalPlugin from "../src/goal";

type HarnessAPI = Pick<
  PluginAPI,
  | "activeThread"
  | "configuration"
  | "experimental"
  | "helpers"
  | "logger"
  | "on"
  | "registerCommand"
  | "registerTool"
>;

interface HarnessOptions {
  staleReadsAfterMutation?: number;
  statusItem?: boolean;
}

type ConfigurationTarget = Parameters<PluginAPI["configuration"]["update"]>[1];

const subscription: Subscription = { unsubscribe() {} };
const logger: PluginAPI["logger"] = { log() {} };
const shell: PluginCommandContext["$"] = async () => ({ exitCode: 0, stderr: "", stdout: "" });
const ai: PluginCommandContext["ai"] = {
  async ask() {
    return { probability: 0, reason: "test", result: "no" };
  },
  async generate() {
    return "";
  },
};
const system: PluginCommandContext["system"] = {
  ampURL: new URL("https://ampcode.com"),
  executor: { kind: "local" },
  async open() {},
  user: null,
  workspaceRoot: null,
};

let nextThreadId = 0;

function createHarness(
  initialConfig: Record<string, unknown> = {},
  threadId = `T-test-${(nextThreadId += 1)}` as ThreadID,
  options: HarnessOptions = {},
) {
  const config = structuredClone(initialConfig);
  const globalConfig: Record<string, unknown> = {};
  const commands = new Map<string, (ctx: PluginCommandContext) => void | Promise<void>>();
  const handlers = new Map<string, (event: unknown) => unknown>();
  const statusItems: Array<string> = [];
  const thread = createThread(threadId);
  const tools = new Map<string, PluginToolDefinition>();
  let staleConfig = mergedConfig();
  let staleReadsRemaining = 0;

  function mergedConfig() {
    return { ...globalConfig, ...config };
  }

  function configForTarget(target: ConfigurationTarget) {
    return target === "global" ? globalConfig : config;
  }

  const configuration: PluginAPI["configuration"] = {
    async delete(key: string, target?: ConfigurationTarget) {
      staleConfig = mergedConfig();
      staleReadsRemaining = options.staleReadsAfterMutation ?? 0;
      delete configForTarget(target)[key];
    },
    async get() {
      if (staleReadsRemaining > 0) {
        staleReadsRemaining -= 1;
        return structuredClone(staleConfig);
      }
      return structuredClone(mergedConfig());
    },
    pipe<Out>(op: (input: PluginAPI["configuration"]) => Out) {
      return op(configuration);
    },
    subscribe() {
      return subscription;
    },
    [Symbol.observable]() {
      return configuration;
    },
    async update(update: Record<string, unknown>, target?: ConfigurationTarget) {
      staleConfig = mergedConfig();
      staleReadsRemaining = options.staleReadsAfterMutation ?? 0;
      Object.assign(configForTarget(target), structuredClone(update));
    },
  } satisfies PluginAPI["configuration"];

  const activeThread: PluginAPI["activeThread"] = {
    current: { id: threadId },
    pipe<Out>(op: (input: PluginAPI["activeThread"]) => Out) {
      return op(activeThread);
    },
    subscribe() {
      return subscription;
    },
    [Symbol.observable]() {
      return activeThread;
    },
  } satisfies PluginAPI["activeThread"];

  const amp = {
    activeThread,
    configuration,
    experimental: options.statusItem
      ? ({
          createStatusItem(value) {
            if (value) {
              statusItems.push(value.text);
            }
            return {
              unsubscribe() {},
              update(nextValue) {
                statusItems.push(nextValue.text);
              },
            };
          },
        } as PluginAPI["experimental"])
      : undefined,
    helpers: {
      filePathFromURI(uri) {
        return uri.toString();
      },
      filesModifiedByToolCall() {
        return null;
      },
      isPluginUINotAvailableError() {
        return false;
      },
      shellCommandFromToolCall() {
        return null;
      },
      toolCallsInMessages() {
        return [];
      },
    },
    logger,
    on(name, handler) {
      handlers.set(name, (event: unknown) =>
        handler(event as PluginEventMap[typeof name], eventContext(thread)),
      );
      return subscription;
    },
    registerCommand(name, _metadata, handler) {
      commands.set(name, handler);
      return { ...subscription, setAvailability() {} };
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
      return subscription;
    },
  } satisfies HarnessAPI;

  goalPlugin(amp as unknown as PluginAPI);

  return { commands, config, globalConfig, handlers, statusItems, thread, threadId, tools };
}

function observable<T>(): Observable<T> {
  const value: Observable<T> = {
    pipe<Out>(op: (input: Observable<T>) => Out) {
      return op(value);
    },
    subscribe() {
      return subscription;
    },
    [Symbol.observable]() {
      return value;
    },
  } satisfies Observable<T>;

  return value;
}

function getObservable<T>(current: T): Observable<T> & { get(): Promise<T> } {
  return {
    ...observable<T>(),
    async get() {
      return current;
    },
  };
}

function createThread(threadId: ThreadID) {
  const thread: PluginThread = {
    async agent() {
      return agent;
    },
    async append() {},
    async appendUserMessage() {},
    async cancel() {},
    id: threadId,
    async messages() {
      return [];
    },
    state: getObservable("idle"),
    title: getObservable(null),
    async waitForResponse() {
      return { content: [], id: "A-test", role: "assistant" };
    },
  };

  const agent: Agent = {
    async createThread() {
      return thread;
    },
    definition: { kind: "builtin-agent", mode: "smart" },
    async run() {
      return { text: "", threadID: threadId };
    },
  };

  return thread;
}

function eventContext<E extends keyof PluginEventMap>(thread: PluginThread): PluginEventContext<E> {
  return { $: shell, ai, logger, system, thread, ui: createUI() } as PluginEventContext<E>;
}

function commandContext(
  thread: PluginThread,
  select?: (options: PluginSelectOptions) => string | undefined | Promise<string | undefined>,
): PluginCommandContext {
  return { $: shell, ai, system, thread, ui: createUI(select) };
}

function toolContext(thread: PluginThread): PluginToolContext {
  return { logger, thread, ui: createUI() };
}

function createUI(
  select?: (options: PluginSelectOptions) => string | undefined | Promise<string | undefined>,
) {
  return {
    async confirm() {
      return false;
    },
    async input() {
      return undefined;
    },
    async notify() {},
    async select(options: PluginSelectOptions) {
      return select ? select(options) : undefined;
    },
  } satisfies PluginCommandContext["ui"];
}

function goalRecord(objective: string, updatedAt: number) {
  return {
    activeDurationMs: 0,
    activeSince: updatedAt - 1000,
    createdAt: updatedAt - 1000,
    objective,
    status: "active",
    updatedAt,
  };
}

async function callTool(
  harness: ReturnType<typeof createHarness>,
  tool: string,
  input: Record<string, unknown> = {},
) {
  const definition = harness.tools.get(tool);
  expect(definition).toBeDefined();

  try {
    const output = await definition?.execute(input, toolContext(harness.thread));
    return { exitCode: 0, output: String(output ?? "") };
  } catch (error) {
    return { exitCode: 1, output: error instanceof Error ? error.message : String(error) };
  }
}

describe("goal plugin public seam", () => {
  test("creates goals, guards completion, and injects hidden continuation context", async () => {
    const harness = createHarness();

    const created = await callTool(harness, "create_goal", { objective: "ship plugin" });
    expect(created.output).toContain("ship plugin");

    await callTool(harness, "create_workflow", {
      steps: [
        { id: "inspect", status: "pending", text: "Inspect behavior" },
        { depends_on: ["inspect"], id: "verify", text: "Verify behavior" },
      ],
      verification: ["workflow check"],
    });

    const completion = await callTool(harness, "update_goal", { status: "complete" });
    expect(completion.exitCode).toBe(1);
    expect(completion.output).toContain("workflow still has unfinished steps");

    const agentStart = harness.handlers.get("agent.start");
    const context = (await agentStart?.({
      id: "M-test",
      message: "continue",
      thread: { id: harness.threadId },
    } satisfies AgentStartEvent)) as AgentStartResult | undefined;

    expect(context?.message?.display).toBe(false);
    expect(context?.message?.content).toContain("ship plugin");
    expect(context?.message?.content).toContain("Workflow:");
  });

  test("registered tool execute path reports validation failures as tool errors", async () => {
    const harness = createHarness();
    const createGoal = harness.tools.get("create_goal");

    await expect(createGoal?.execute({}, toolContext(harness.thread))).rejects.toThrow(
      "objective is required",
    );
  });

  test("status item uses top-level active thread with latest plugin API", async () => {
    const harness = createHarness({}, undefined, { statusItem: true });
    const sessionStart = harness.handlers.get("session.start");

    await sessionStart?.({ thread: { id: harness.threadId } });
    await callTool(harness, "create_goal", { objective: "show status" });

    expect(harness.statusItems.some((item) => item.includes("Goal active"))).toBe(true);
  });

  test("newest valid goal wins across current and legacy config keys", async () => {
    const now = Date.now();
    const threadId = "T-test-newest";
    const harness = createHarness(
      {
        [`amp.goalPlugin.thread.${threadId}`]: goalRecord("newer thread", now - 20),
        [`goalPlugin.thread.${threadId}`]: goalRecord("older thread", now - 30),
        goalPlugin: { threads: { [threadId]: goalRecord("newest legacy", now - 5) }, version: 1 },
      },
      threadId,
    );

    const result = await callTool(harness, "get_goal");

    expect(result.output).toContain("newest legacy");
  });

  test("expired same-turn override does not resurrect deleted config", async () => {
    const realNow = Date.now;
    const start = realNow();
    Date.now = () => start;
    try {
      const harness = createHarness();

      await callTool(harness, "create_goal", { objective: "delete me" });
      delete harness.globalConfig[`goalPlugin.thread.${harness.threadId}`];

      Date.now = () => start + 60_000;
      const result = await callTool(harness, "get_goal");

      expect(result.output).toContain("No goal set");
    } finally {
      Date.now = realNow;
    }
  });

  test("global writes clear stale workspace thread state after override expires", async () => {
    const realNow = Date.now;
    const start = realNow();
    const threadId = "T-test-workspace-shadow";
    Date.now = () => start;
    try {
      const harness = createHarness(
        { [`goalPlugin.thread.${threadId}`]: goalRecord("old workspace", start + 10_000) },
        threadId,
        { staleReadsAfterMutation: 3 },
      );

      const replaced = await callTool(harness, "replace_goal", { objective: "new global" });
      expect(replaced.output).toContain("new global");

      Date.now = () => start + 60_000;
      const result = await callTool(harness, "get_goal");

      expect(result.output).toContain("new global");
      expect(result.output.includes("old workspace")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test("global writes clear amp-prefixed global thread shadows", async () => {
    const realNow = Date.now;
    const start = realNow();
    const threadId = "T-test-global-amp-shadow";
    Date.now = () => start;
    try {
      const harness = createHarness({}, threadId);
      harness.globalConfig[`amp.goalPlugin.thread.${threadId}`] = goalRecord(
        "old amp shadow",
        start + 10_000,
      );

      const replaced = await callTool(harness, "replace_goal", { objective: "new global" });
      expect(replaced.output).toContain("new global");

      Date.now = () => start + 60_000;
      const result = await callTool(harness, "get_goal");

      expect(result.output).toContain("new global");
      expect(result.output.includes("old amp shadow")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test("global writes clear stale workspace legacy state after override expires", async () => {
    const realNow = Date.now;
    const start = realNow();
    const threadId = "T-test-workspace-legacy-shadow";
    Date.now = () => start;
    try {
      const harness = createHarness(
        {
          goalPlugin: {
            threads: { [threadId]: goalRecord("old workspace legacy", start + 10_000) },
            version: 1,
          },
        },
        threadId,
        { staleReadsAfterMutation: 3 },
      );

      const replaced = await callTool(harness, "replace_goal", { objective: "new global" });
      expect(replaced.output).toContain("new global");

      Date.now = () => start + 60_000;
      const result = await callTool(harness, "get_goal");

      expect(result.output).toContain("new global");
      expect(result.output.includes("old workspace legacy")).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  test("goal creation waits for config reads to observe the write", async () => {
    const harness = createHarness({}, undefined, { staleReadsAfterMutation: 2 });

    await callTool(harness, "create_goal", { objective: "eventually visible" });

    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      const result = await callTool(harness, "get_goal");

      expect(result.output).toContain("eventually visible");
    } finally {
      Date.now = realNow;
    }
  });

  test("goal updates wait by value instead of object key order", async () => {
    const harness = createHarness();

    await callTool(harness, "create_goal", { objective: "handoff order" });
    const result = await callTool(harness, "update_goal_handoff", {
      purpose: "resume",
      summary: "state to preserve",
    });

    expect(result.output).toContain("Handoff Note: resume");
  });

  test("workflow dialog keeps dependencies and verification details", async () => {
    const now = Date.now();
    const threadId = "T-test-workflow-page";
    const harness = createHarness(
      {
        [`goalPlugin.thread.${threadId}`]: {
          activeDurationMs: 0,
          activeSince: now - 1000,
          createdAt: now - 1000,
          objective: "ui",
          status: "active",
          updatedAt: now,
          workflow: {
            events: [],
            steps: [
              {
                dependsOn: [],
                id: "inspect",
                phase: "Discovery",
                status: "done",
                text: "Inspect behavior",
                verification: [],
              },
              {
                dependsOn: ["inspect"],
                evidence: "seen",
                id: "verify",
                phase: "Verification",
                status: "active",
                text: "Verify behavior",
                verification: ["step check"],
              },
            ],
            verification: ["workflow check"],
          },
        },
      },
      threadId,
    );
    let page = "";

    await harness.commands.get("goal-workflow")?.(
      commandContext(harness.thread, (options) => {
        page = options.message ?? "";
        return "Close";
      }),
    );

    expect(page).toContain("All steps:");
    expect(page).toContain("Phase: Verification");
    expect(page).toContain("after: inspect");
    expect(page).toContain("verify: step check");
    expect(page).toContain("Verification:");
    expect(page).toContain("workflow check");
  });
});
