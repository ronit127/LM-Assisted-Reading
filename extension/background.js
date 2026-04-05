// Service worker — handles Claude API calls so the API key never touches
// the content script context (which is accessible to the host page).

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // fast + cheap for annotations

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "QUERY") {
    handleQuery(message).then(sendResponse).catch((err) => {
      sendResponse({ error: err.message });
    });
    return true; // keep the message channel open for async response
  }

  if (message.type === "TOGGLE_PANEL") {
    // Forwarded from popup — relay to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "TOGGLE_PANEL" });
      }
    });
    return false;
  }
});

async function handleQuery({ query, selectedText, contextBlocks, anchorUid }) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    throw new Error("No API key set. Open the extension popup to add your Anthropic API key.");
  }

  const contextText = contextBlocks
    .map((b) => `[${b.uid}] ${b.text}`)
    .join("\n\n");

  const systemPrompt = `You are a reading assistant embedded inline in a webpage.
The user has selected some text and asked a question about it.
Respond with a concise, helpful annotation (2-5 sentences max) that answers the user's query.
Do not repeat the selected text back. Focus on clarifying, explaining, or expanding on it.
Reply with ONLY the annotation text — no preamble, no JSON, no markdown headers.`;

  const userMessage = `Page context (surrounding paragraphs):
${contextText}

Selected text the user is asking about:
"${selectedText}"

User's query: ${query}`;

  const response = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();
  const annotationText = data.content?.[0]?.text ?? "";

  return { annotationText, anchorUid };
}
