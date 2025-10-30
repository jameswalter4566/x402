import { Router, Request, Response } from "express";

type ProxyHandler = (req: Request) => Promise<{
  response: globalThis.Response;
  body: unknown;
}>;

const router = Router();

const BASE_URL = process.env.CLAUDE_BASE_URL ?? "https://api.anthropic.com/v1";
const DEFAULT_VERSION = process.env.CLAUDE_API_VERSION ?? "2023-06-01";
const BETA_HEADER = process.env.CLAUDE_BETA;

const resolveApiKey = () => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    throw new Error("CLAUDE_API_KEY is not configured");
  }
  return apiKey;
};

const buildHeaders = () => {
  const headers: Record<string, string> = {
    "x-api-key": resolveApiKey(),
    "anthropic-version": DEFAULT_VERSION,
    "content-type": "application/json",
  };

  if (BETA_HEADER && BETA_HEADER.trim().length > 0) {
    headers["anthropic-beta"] = BETA_HEADER.trim();
  }

  return headers;
};

const forwardRequest = async (
  url: string,
  options: RequestInit,
): Promise<{ response: globalThis.Response; body: unknown }> => {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") ?? "";
  const shouldParseJson =
    contentType.includes("application/json") || contentType.includes("+json");
  const body = shouldParseJson ? await response.json() : await response.text();

  return { response, body };
};

const handleProxy =
  (handler: ProxyHandler) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { response, body } = await handler(req);
      res.status(response.status);
      if (typeof body === "string") {
        res.set("content-type", response.headers.get("content-type") ?? "text/plain");
        res.send(body);
        return;
      }
      res.json(body);
    } catch (error) {
      console.error("Claude proxy error", error);
      if (error instanceof Error && error.message === "CLAUDE_API_KEY is not configured") {
        res.status(500).json({
          error: "Gateway misconfigured",
          details: error.message,
        });
        return;
      }
      res.status(500).json({
        error: "Internal error calling Claude",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

router.post(
  "/messages",
  handleProxy(async req =>
    forwardRequest(`${BASE_URL}/messages`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {}),
    }),
  ),
);

export default router;
