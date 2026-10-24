import { generateText } from "ai";
import { aiInfo, getModel } from "@/server/ai";

/**
 * Server-only AI endpoint (the browser never sees the gateway token or any
 * provider key).
 *
 *   GET  /api/ai   -> which provider/model is wired up
 *   POST /api/ai   { "prompt": "..." } -> { text, model, source, latencyMs }
 */
export function GET() {
  const { source, model } = aiInfo();
  return Response.json({ configured: source !== "none", source, model });
}

export async function POST(req: Request) {
  const model = getModel();
  const { source, model: modelId } = aiInfo();
  if (!model) {
    return Response.json(
      { error: "No AI provider configured (NEON_AI_GATEWAY_* or AI_API_KEY)" },
      { status: 503 },
    );
  }

  let prompt: unknown;
  try {
    ({ prompt } = await req.json());
  } catch {
    return Response.json(
      { error: "Body must be JSON: { prompt: string }" },
      { status: 400 },
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return Response.json({ error: "`prompt` is required" }, { status: 400 });
  }

  const started = Date.now();
  try {
    const { text } = await generateText({
      model,
      prompt: prompt.slice(0, 4000),
    });
    return Response.json({
      text: text.trim(),
      source,
      model: modelId,
      latencyMs: Date.now() - started,
    });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : String(err),
        source,
        model: modelId,
      },
      { status: 502 },
    );
  }
}
