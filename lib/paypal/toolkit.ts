// Executes PayPal actions through the official PayPal Agent Toolkit
// (@paypal/agent-toolkit, OpenAI tool-calling flavor). The same executor is
// used by the LLM agent loop and by the deterministic fallback, so every
// PayPal call goes through the toolkit's validated tool schemas.

import type { PayPalReady } from "./config";

/** OpenAI Chat Completions tool definition. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ToolExecutor {
  /** True when responses are simulated (PAYPAL_DRY_RUN, no network). */
  readonly simulated: boolean;
  tools(): ToolDefinition[];
  call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export const AGENT_TOOL_NAMES = [
  "create_product",
  "create_subscription_plan",
  "create_order",
  "create_invoice",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

function stripNestedDescriptions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripNestedDescriptions);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "description" && typeof v === "string") continue;
    if (k === "additionalProperties" || k === "$schema") continue;
    out[k] = stripNestedDescriptions(v);
  }
  return out;
}

function firstSentence(text: string | undefined): string | undefined {
  if (!text) return text;
  const trimmed = text.trim();
  const end = trimmed.search(/\.(\s|$)/);
  return (end > 0 ? trimmed.slice(0, end + 1) : trimmed).slice(0, 160);
}

/**
 * The toolkit's schemas carry long per-field docs (create_invoice alone is
 * ~11k chars). Keep only the named tools, their top-level description, and
 * the full parameter structure, so the agent fits small-context and
 * rate-limited models (Groq free tier is 8k tokens/minute).
 */
export function compactTools(tools: ToolDefinition[], names: readonly string[]): ToolDefinition[] {
  return tools
    .filter((t) => names.includes(t.function.name))
    .map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: firstSentence(t.function.description),
        parameters: stripNestedDescriptions(t.function.parameters) as Record<string, unknown> | undefined,
      },
    }));
}

/** Toolkit `configuration.actions` enabling only what the agent may do. */
export const AGENT_ACTIONS = {
  products: { create: true },
  subscriptionPlans: { create: true },
  orders: { create: true },
  invoices: { create: true },
};

export class ToolCallError extends Error {
  constructor(
    readonly tool: string,
    message: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

interface ToolkitLike {
  getTools(): ToolDefinition[];
  handleToolCall(call: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }): Promise<{ content: unknown }>;
}

async function loadToolkit(clientId: string, clientSecret: string): Promise<ToolkitLike> {
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/openai");
  return new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: { actions: AGENT_ACTIONS, context: { sandbox: true } },
  }) as unknown as ToolkitLike;
}

let seq = 0;

export function wrapToolkit(toolkit: ToolkitLike, simulated = false): ToolExecutor {
  return {
    simulated,
    tools: () => toolkit.getTools().filter((t) => (AGENT_TOOL_NAMES as readonly string[]).includes(t.function.name)),
    async call(name, args) {
      const res = await toolkit.handleToolCall({
        id: `call_${Date.now()}_${seq++}`,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      });
      const raw = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new ToolCallError(name, "PayPal returned a non-JSON response", raw);
      }
      if (!parsed || typeof parsed !== "object") {
        throw new ToolCallError(name, "PayPal returned an empty response", parsed);
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.error) {
        const err = obj.error as { message?: string };
        throw new ToolCallError(name, err.message ?? "PayPal tool call failed", obj);
      }
      return obj;
    },
  };
}

export async function createToolkitExecutor(cfg: PayPalReady): Promise<ToolExecutor> {
  return wrapToolkit(await loadToolkit(cfg.clientId, cfg.clientSecret));
}

// ---------------------------------------------------------------------------
// Dry run: real toolkit tool schemas, simulated PayPal responses
// ---------------------------------------------------------------------------

const rid = (prefix: string) =>
  `${prefix}-DRYRUN${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

export function simulatedResponse(name: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "create_product":
      return { id: rid("PROD"), name: args.name, type: args.type, create_time: new Date().toISOString() };
    case "create_subscription_plan":
      return { id: rid("P"), product_id: args.product_id, name: args.name, status: "ACTIVE" };
    case "create_order": {
      const id = rid("ORDER");
      return {
        id,
        status: "CREATED",
        links: [{ rel: "approve", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
      };
    }
    case "create_invoice":
      return { id: rid("INV2"), status: "DRAFT" };
    default:
      throw new ToolCallError(name, `Tool ${name} is not available in dry run`);
  }
}

export async function createDryRunExecutor(): Promise<ToolExecutor> {
  let schemas: ToolDefinition[] = [];
  try {
    // Constructing the toolkit makes no network calls; it only builds schemas.
    schemas = (await loadToolkit("dry-run", "dry-run")).getTools();
  } catch {
    schemas = AGENT_TOOL_NAMES.map((name) => ({ type: "function", function: { name } }));
  }
  return {
    simulated: true,
    tools: () => schemas.filter((t) => (AGENT_TOOL_NAMES as readonly string[]).includes(t.function.name)),
    call: async (name, args) => simulatedResponse(name, args),
  };
}
