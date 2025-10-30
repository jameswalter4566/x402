import { Router, Request, Response } from "express";

const router = Router();

const BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";

const resolveApiKey = () => {
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_SHEETS_API_KEY is not configured");
  }
  return apiKey;
};

const ensureString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
};

const sendError = (res: Response, error: unknown) => {
  console.error("Google Sheets proxy error", error);
  if (error instanceof Error && error.message === "GOOGLE_SHEETS_API_KEY is not configured") {
    res.status(500).json({ error: "Gateway misconfigured", details: error.message });
    return;
  }
  res.status(500).json({
    error: "google_sheets_proxy_failure",
    details: error instanceof Error ? error.message : String(error),
  });
};

router.post("/values/get", async (req: Request, res: Response) => {
  try {
    const apiKey = resolveApiKey();
    const spreadsheetId = ensureString(req.body?.spreadsheetId, "spreadsheetId");
    const range = ensureString(req.body?.range, "range");
    const majorDimension = typeof req.body?.majorDimension === "string" ? req.body.majorDimension : undefined;

    const url = new URL(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    url.searchParams.set("key", apiKey);
    if (majorDimension) {
      url.searchParams.set("majorDimension", majorDimension);
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const body = await response.text();
      res.status(response.status).json({ error: "google_sheets_error", body });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/values/update", async (req: Request, res: Response) => {
  try {
    const apiKey = resolveApiKey();
    const spreadsheetId = ensureString(req.body?.spreadsheetId, "spreadsheetId");
    const range = ensureString(req.body?.range, "range");
    const values = Array.isArray(req.body?.values) ? req.body.values : undefined;
    const valueInputOption = typeof req.body?.valueInputOption === "string" ? req.body.valueInputOption : "USER_ENTERED";

    if (!values) {
      throw new Error("values array is required");
    }

    const url = new URL(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("valueInputOption", valueInputOption);

    const response = await fetch(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      const body = await response.text();
      res.status(response.status).json({ error: "google_sheets_error", body });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

router.post("/values/append", async (req: Request, res: Response) => {
  try {
    const apiKey = resolveApiKey();
    const spreadsheetId = ensureString(req.body?.spreadsheetId, "spreadsheetId");
    const range = ensureString(req.body?.range, "range");
    const values = Array.isArray(req.body?.values) ? req.body.values : undefined;
    const valueInputOption = typeof req.body?.valueInputOption === "string" ? req.body.valueInputOption : "USER_ENTERED";
    const insertDataOption = typeof req.body?.insertDataOption === "string" ? req.body.insertDataOption : "INSERT_ROWS";

    if (!values) {
      throw new Error("values array is required");
    }

    const url = new URL(`${BASE_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("valueInputOption", valueInputOption);
    url.searchParams.set("insertDataOption", insertDataOption);

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });

    if (!response.ok) {
      const body = await response.text();
      res.status(response.status).json({ error: "google_sheets_error", body });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
