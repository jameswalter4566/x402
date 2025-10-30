import { Router, Request, Response } from "express";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

const router = Router();

const DEFAULT_SYSTEM_PROMPT =
  "You are an automation architect for the x402 marketplace. When a user describes a task, explain how you will orchestrate it by combining our available third-party APIs (OpenAI, Claude, Google Sheets, Discord, on-chain actions, etc.). Always respond with a friendly plan that lists the nodes to create, the order they execute, and how much SOL/USDC to fund for execution.";

const OPENAI_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = process.env.AUTOMATION_ASSISTANT_MODEL ?? "gpt-4o-mini";

const resolveOpenAiKey = (): string => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return apiKey;
};

const sanitiseHistory = (history: unknown): ChatMessage[] => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map(message => {
      if (
        typeof message !== "object" ||
        message === null ||
        (message as { role?: unknown }).role === undefined ||
        (message as { content?: unknown }).content === undefined
      ) {
        return null;
      }

      const role = (message as { role: unknown }).role;
      const content = (message as { content: unknown }).content;

      if ((role !== "assistant" && role !== "user") || typeof content !== "string") {
        return null;
      }

      return {
        role,
        content: content.slice(0, 6000),
      } satisfies ChatMessage;
    })
    .filter((message): message is ChatMessage => message !== null)
    .slice(-12);
};

router.post("/assistant", async (req: Request, res: Response) => {
  try {
    const apiKey = resolveOpenAiKey();
    const {
      prompt,
      history,
      automationName,
      walletAddress,
      systemPrompt,
      autoPublish,
      moderation,
    } = (req.body ?? {}) as {
      prompt?: unknown;
      history?: unknown;
      automationName?: unknown;
      walletAddress?: unknown;
      systemPrompt?: unknown;
      autoPublish?: unknown;
      moderation?: unknown;
    };

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      res.status(400).json({ error: "prompt_required" });
      return;
    }

    const trimmedPrompt = prompt.trim();
    const messages: Array<{ role: "system" | "assistant" | "user"; content: string }> = [
      {
        role: "system",
        content:
          typeof systemPrompt === "string" && systemPrompt.trim().length > 0
            ? `${DEFAULT_SYSTEM_PROMPT}\n\n${systemPrompt.trim()}`
            : DEFAULT_SYSTEM_PROMPT,
      },
    ];

    const metadataSummary = [
      `Automation name: ${typeof automationName === "string" && automationName.trim().length > 0 ? automationName.trim() : "untitled flow"}`,
      walletAddress && typeof walletAddress === "string" ? `Agent wallet: ${walletAddress}` : null,
      `Auto publish enabled: ${Boolean(autoPublish)}`,
      `Human review required: ${Boolean(moderation)}`,
    ]
      .filter(Boolean)
      .join("\n");

    messages.push({
      role: "assistant",
      content: `Context summary:\n${metadataSummary}`,
    });

    const cleanedHistory = sanitiseHistory(history);
    messages.push(...cleanedHistory);
    messages.push({
      role: "user",
      content: trimmedPrompt,
    });

    const response = await fetch(OPENAI_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 900,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Automation assistant OpenAI error", response.status, errorBody);
      res.status(502).json({
        error: "assistant_upstream_failure",
        status: response.status,
        body: errorBody,
      });
      return;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: unknown;
      model?: string;
    };

    const reply = data.choices?.[0]?.message?.content ?? "";
    res.json({
      reply,
      usage: data.usage,
      model: data.model ?? DEFAULT_MODEL,
    });
  } catch (error) {
    console.error("Automation assistant error", error);
    if (error instanceof Error && error.message === "OPENAI_API_KEY is not configured") {
      res.status(500).json({ error: "missing_openai_api_key" });
      return;
    }
    res.status(500).json({
      error: "automation_assistant_error",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
