import { Router, Request, Response } from "express";

const router = Router();

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";

type ProxyHandler = (req: Request) => Promise<{
  response: globalThis.Response;
  body: unknown;
}>;

const resolveApiKey = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return apiKey;
};

const buildHeaders = () => ({
  Authorization: `Bearer ${resolveApiKey()}`,
  "Content-Type": "application/json",
});

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
      console.error("OpenAI proxy error", error);
      if (error instanceof Error && error.message === "OPENAI_API_KEY is not configured") {
        res
          .status(500)
          .json({ error: "Gateway misconfigured", details: error.message });
        return;
      }
      res.status(500).json({
        error: "Internal error calling OpenAI",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };

router.post(
  "/completions",
  handleProxy(async req =>
    forwardRequest(`${BASE_URL}/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {}),
    }),
  ),
);

router.post(
  "/chat/completions",
  handleProxy(async req =>
    forwardRequest(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {}),
    }),
  ),
);

router.post(
  "/images/generations",
  handleProxy(async req =>
    forwardRequest(`${BASE_URL}/images/generations`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {}),
    }),
  ),
);

router.get(
  "/models",
  handleProxy(async () =>
    forwardRequest(`${BASE_URL}/models`, {
      method: "GET",
      headers: buildHeaders(),
    }),
  ),
);

export default router;
