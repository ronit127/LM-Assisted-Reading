// Precomputed block embeddings per page: pageUrl -> Map(uid -> number[])
const pageEmbeddings = new Map();

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PRECOMPUTE_EMBEDDINGS") {
    chrome.storage.local.get("awsCreds", ({ awsCreds }) => {
      if (!awsCreds?.accessKeyId) return;
      precomputeEmbeddings(msg.blocks, msg.pageUrl, awsCreds, msg.region || "us-east-1");
    });
    return false;
  }

  if (msg.type !== "CHAT_REQUEST") return false;

  (async () => {
    try {
      const { accessKeyId, secretAccessKey, region = "us-east-1" } = msg.awsCreds;
      const { selectedText, messages, blocks = [], mode = "ask", selectedBlockUids = [], pageUrl } = msg;

      // Semantic retrieval: rank blocks by embedding similarity to the current query
      const currentQuery = messages[messages.length - 1]?.content || "";
      const relevantBlocks = await selectRelevantBlocks(
        currentQuery, blocks, selectedBlockUids,
        { accessKeyId, secretAccessKey }, region, pageUrl
      );

      const systemPrompt = buildSystemPrompt(mode, selectedText, relevantBlocks, selectedBlockUids);
      const modelId      = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
      const url          = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

      const converseMessages = messages.slice(-10).map(m => ({
        role: m.role,
        content: [{ text: m.content }],
      }));

      const body = JSON.stringify({
        system: [{ text: systemPrompt }],
        messages: converseMessages,
        inferenceConfig: { maxTokens: 1024 },
      });

      const headers = await signV4({
        method: "POST", url, body, region,
        accessKeyId, secretAccessKey, service: "bedrock",
      });

      const res  = await fetch(url, { method: "POST", headers, body });
      const data = await res.json();

      if (!res.ok) {
        sendResponse({ error: data.message || `HTTP ${res.status}` });
        return;
      }

      const raw = data.output?.message?.content?.[0]?.text ?? "";
      const parsed = extractFirstJson(raw);
      if (parsed !== null) {
        sendResponse({ parsed, mode });
      } else {
        const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        sendResponse({ text, mode });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});

// ── JSON extraction ───────────────────────────────────────────────────────────

function extractFirstJson(text) {
  // 1. Try direct parse of the full response
  try { return JSON.parse(text.trim()); } catch {}

  // 2. Strip markdown code fences and retry
  const stripped = text
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  try { return JSON.parse(stripped); } catch {}

  // 3. Bracket scan: find the first { or [ and try every possible end position
  //    in reverse (longest match first) so we get the full object, not a prefix.
  for (const [open, close] of [["{", "}"], ["[", "]"]]) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    let pos = text.lastIndexOf(close);
    while (pos > start) {
      try { return JSON.parse(text.slice(start, pos + 1)); } catch {}
      pos = text.lastIndexOf(close, pos - 1);
    }
  }

  return null;
}

// ── Semantic retrieval via Titan Text Embeddings ──────────────────────────────

async function precomputeEmbeddings(blocks, pageUrl, awsCreds, region) {
  const cache = new Map();
  pageEmbeddings.set(pageUrl, cache);
  // Embed in batches of 5 to stay within Bedrock rate limits
  for (let i = 0; i < blocks.length; i += 5) {
    const batch = blocks.slice(i, i + 5);
    await Promise.all(batch.map(async b => {
      const emb = await embedText(b.text, awsCreds, region);
      if (emb) cache.set(b.uid, emb);
    }));
    if (i + 5 < blocks.length) await new Promise(r => setTimeout(r, 150));
  }
}

async function selectRelevantBlocks(query, blocks, selectedBlockUids, awsCreds, region, pageUrl) {
  const selectedSet = new Set(selectedBlockUids);
  const cache = pageEmbeddings.get(pageUrl);

  if (!cache || cache.size < 3) {
    // Embeddings not ready yet — fall back to selected block + ±5 neighbors
    const allUids = blocks.map(b => b.uid);
    const window = new Set(selectedBlockUids);
    selectedBlockUids.forEach(uid => {
      const idx = allUids.indexOf(uid);
      for (let i = Math.max(0, idx - 5); i <= Math.min(allUids.length - 1, idx + 5); i++) {
        window.add(allUids[i]);
      }
    });
    const ctx  = blocks.filter(b =>  window.has(b.uid));
    const rest = blocks.filter(b => !window.has(b.uid)).slice(0, Math.max(0, 15 - ctx.length));
    return [...ctx, ...rest];
  }

  // Embed the query and rank all cached blocks by cosine similarity
  const queryEmb = await embedText(query, awsCreds, region);
  if (!queryEmb) return blocks.slice(0, 15);

  const scored = blocks
    .map(b => ({
      b,
      // User-selected blocks always rank highest; rest ranked by embedding similarity
      score: selectedSet.has(b.uid) ? 2 : (cache.has(b.uid) ? cosineSimilarity(queryEmb, cache.get(b.uid)) : -1),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 15).map(s => s.b);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // Titan returns L2-normalized vectors when normalize: true, so dot == cosine
}

async function embedText(text, awsCreds, region = "us-east-1") {
  try {
    const { accessKeyId, secretAccessKey } = awsCreds;
    const modelId = "amazon.titan-embed-text-v2:0";
    const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
    const body = JSON.stringify({ inputText: text.slice(0, 2000), dimensions: 256, normalize: true });
    const headers = await signV4({ method: "POST", url, body, region, accessKeyId, secretAccessKey, service: "bedrock" });
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSystemPrompt(mode, selectedText, blocks, selectedBlockUids) {
  const blockLines = blocks.map(b =>
    b.isSelected
      ? `[${b.uid}] ← USER SELECTION: ${b.text}`
      : `[${b.uid}]: ${b.text}`
  ).join("\n");

  const selCtx = selectedText ? `\nHighlighted text: "${selectedText}"` : "";

  if (mode === "edit") {
    const isMulti = selectedBlockUids.length > 1;
    const uidList = selectedBlockUids.join('", "');
    if (isMulti) {
      const schema = selectedBlockUids.map(uid => `{"uid":"${uid}","editedText":"<rewritten>"}`).join(", ");
      return `You are a reading assistant that rewrites text to be clearer and more accessible.
Selected text spans ${selectedBlockUids.length} blocks: ["${uidList}"]${selCtx}

Page context:
${blockLines}

Rewrite each selected block independently but consistently.
Respond with ONLY valid JSON: {"edits":[${schema}]}`;
    } else {
      const uid = selectedBlockUids[0];
      return `You are a reading assistant that rewrites text to be clearer and more accessible.
Selected text: "${selectedText}" in block [${uid}]

Page context:
${blockLines}

Rewrite the selected text. Keep the same meaning, make it clearer.
Respond with ONLY valid JSON: {"uid":"${uid}","editedText":"<your rewrite>"}`;
    }
  }

  return `You are a reading assistant that answers questions about web page content.

Page blocks (each with a UID):
${blockLines}
${selCtx}

The block marked "← USER SELECTION" is where the user is focused. Prioritize it and its neighbors.
Respond with ONLY valid JSON: {"uid":"<most relevant block uid>","answer":"<your answer>"}`;
}

// ── AWS Signature Version 4 ───────────────────────────────────────────────────

function sigV4Encode(str) {
  return [...str].map(c => {
    if (/[A-Za-z0-9\-._~]/.test(c)) return c;
    return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  }).join("");
}

async function signV4({ method, url, body, region, accessKeyId, secretAccessKey, service }) {
  const urlObj = new URL(url);
  const host   = urlObj.hostname;

  // SigV4 canonical URI: encode each path segment individually
  const canonicalUri = urlObj.pathname.split("/").map(sigV4Encode).join("/");

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders    = "content-type;host;x-amz-date";
  const payloadHash      = await sha256hex(body);

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const algorithm       = "AWS4-HMAC-SHA256";
  const stringToSign    = [algorithm, amzDate, credentialScope, await sha256hex(canonicalRequest)].join("\n");

  const signingKey = await getSigningKey(secretAccessKey, dateStamp, region, service);
  const signature  = await hmacHex(signingKey, stringToSign);

  return {
    "Content-Type":  "application/json",
    "X-Amz-Date":   amzDate,
    "Authorization": `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function sha256hex(message) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacRaw(key, message) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
}

async function hmacHex(key, message) {
  const buf = await hmacRaw(key, message);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSigningKey(secret, dateStamp, region, service) {
  const kDate    = await hmacRaw(new TextEncoder().encode("AWS4" + secret), dateStamp);
  const kRegion  = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, "aws4_request");
}
