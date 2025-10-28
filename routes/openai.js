import express from "express";

const router = express.Router();

const BASE_URL = "https://api.openai.com/v1";

const buildHeaders = () => ({
  Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
  "Content-Type": "application/json"
});

const forwardRequest = async (url, options = {}) => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const parseAsJson = contentType.includes("application/json") || contentType.includes("+json");
  const body = parseAsJson ? await response.json() : await response.text();

  return { response, body };
};

const handleProxy = (handler) => async (req, res) => {
  try {
    const { response, body } = await handler(req);
    res.status(response.status);
    if (typeof body === "string") {
      res.set("content-type", response.headers.get("content-type") || "text/plain");
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    console.error("OpenAI proxy error", error);
    if (error.message === "OPENAI_API_KEY is not configured") {
      res.status(500).json({ error: "Gateway misconfigured", details: error.message });
      return;
    }
    res.status(500).json({ error: "Internal error calling OpenAI", details: error.message });
  }
};

router.post(
  "/completions",
  handleProxy(async (req) =>
    forwardRequest(`${BASE_URL}/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {})
    })
  )
);

router.post(
  "/chat/completions",
  handleProxy(async (req) =>
    forwardRequest(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {})
    })
  )
);

router.post(
  "/images/generations",
  handleProxy(async (req) =>
    forwardRequest(`${BASE_URL}/images/generations`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(req.body ?? {})
    })
  )
);

router.get(
  "/models",
  handleProxy(async (req) =>
    forwardRequest(`${BASE_URL}/models`, {
      method: "GET",
      headers: buildHeaders()
    })
  )
);

export default router;
