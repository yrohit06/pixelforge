// Server-side allowlist of prompt enhancers (never trust raw style modifiers from the browser)
const STYLE_PRESETS = {
  none: "",
  photorealistic: ", ultra realistic photography, natural lighting, 85mm lens, sharp focus, high detail",
  cinematic: ", cinematic film still, dramatic lighting, rich shadows, shallow depth of field, high contrast",
  anime: ", modern anime illustration, clean lineart, vibrant lighting, expressive composition",
  "3d-render": ", 3D Pixar-style render, octane lighting, soft shadows, clean studio composition",
  minimal: ", minimalist flat vector illustration, clean shapes, balanced negative space, crisp edges",
  watercolor: ", delicate watercolor painting on textured paper, soft ink outlines, gentle color bleeds"
};

// Lightweight per-instance rate limiter (pair with Vercel Firewall WAF for global enforcement)
const ipHits = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 6;

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (ipHits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    ipHits.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  ipHits.set(ip, timestamps);
  return false;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;

  // Same-origin browser requests send an Origin matching the deployment host
  if (!origin) return true;

  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin && origin === allowedOrigin) return true;
  if (host && (origin === `https://${host}` || origin === `http://${host}`)) return true;

  return false;
}

export default async function handler(req, res) {
  // 1. Only allow POST requests
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  // 2. Block unauthorized cross-site API abuse
  if (!isAllowedOrigin(req)) {
    return res.status(403).json({ error: "Forbidden origin." });
  }

  // 3. Enforce JSON content type
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    return res.status(415).json({ error: "Content-Type must be application/json." });
  }

  // 4. Per-IP Rate Limiting
  const clientIp =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error: "Too many requests. Please wait 60 seconds before generating again."
    });
  }

  // 5. Strict Input Validation & Sanitization
  const { prompt, style = "photorealistic", steps = 4 } = req.body || {};

  if (typeof prompt !== "string") {
    return res.status(400).json({ error: "Prompt must be text." });
  }

  // Strip control characters and trim whitespace
  const cleanPrompt = prompt.replace(/[\u0000-\u001F\u007F]/g, "").trim();

  if (cleanPrompt.length < 3 || cleanPrompt.length > 500) {
    return res.status(400).json({ error: "Prompt must be between 3 and 500 characters." });
  }

  const styleSuffix = Object.prototype.hasOwnProperty.call(STYLE_PRESETS, style)
    ? STYLE_PRESETS[style]
    : "";

  const safeSteps = Math.min(8, Math.max(2, Number.parseInt(steps, 10) || 4));
  const finalPrompt = `${cleanPrompt}${styleSuffix}`;

  // 6. Call Configured AI Provider with 25-Second Timeout
  const provider = (process.env.AI_PROVIDER || "cloudflare").toLowerCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    let imageDataUrl = "";

    if (provider === "huggingface") {
      const hfToken = process.env.HF_TOKEN;
      if (!hfToken) {
        return res.status(500).json({ error: "Server configuration missing." });
      }

      const hfRes = await fetch(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            inputs: finalPrompt,
            parameters: { num_inference_steps: safeSteps }
          }),
          signal: controller.signal
        }
      );

      if (!hfRes.ok) {
        return res.status(502).json({
          error: "Image engine is busy or quota reached. Please try again shortly."
        });
      }

      const buffer = Buffer.from(await hfRes.arrayBuffer());
      const mime = hfRes.headers.get("content-type") || "image/jpeg";
      imageDataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    } else {
      // Default: Cloudflare Workers AI (Recommended Free Tier: ~173 FLUX images/day)
      const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const cfApiToken = process.env.CLOUDFLARE_API_TOKEN;

      if (!cfAccountId || !cfApiToken) {
        return res.status(500).json({ error: "Server configuration missing." });
      }

      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfApiToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            prompt: finalPrompt,
            steps: safeSteps
          }),
          signal: controller.signal
        }
      );

      if (!cfRes.ok) {
        return res.status(502).json({
          error: "Image engine is busy or daily limit reached. Please try again later."
        });
      }

      const data = await cfRes.json();
      if (!data?.success || !data?.result?.image) {
        return res.status(502).json({ error: "Failed to generate image." });
      }

      imageDataUrl = `data:image/jpeg;base64,${data.result.image}`;
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ image: imageDataUrl });
  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "Generation timed out. Try a simpler prompt." });
    }
    return res.status(500).json({ error: "Unexpected server error. Please try again." });
  } finally {
    clearTimeout(timeout);
  }
}