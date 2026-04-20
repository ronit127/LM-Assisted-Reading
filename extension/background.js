chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "CHAT_REQUEST") return false;

  const { apiKey, selectedText, messages, blocks = [], mode = 'ask', selectedBlockUids = [] } = msg;

  const blockLines = blocks.map(b =>
    b.isSelected
      ? `[${b.uid}] ← USER SELECTION: ${b.text}`
      : `[${b.uid}]: ${b.text}`
  ).join('\n');

  const selectionCtx = selectedText
    ? `\nThe user's highlighted text is: "${selectedText}"`
    : '';

  let systemPrompt;
  if (mode === 'edit') {
    const isMulti = selectedBlockUids.length > 1;
    const uidList = selectedBlockUids.join('", "');

    if (isMulti) {
      const editsSchema = selectedBlockUids.map(uid => `{"uid": "${uid}", "editedText": "<rewritten>"}`).join(', ');
      systemPrompt = `You are a reading assistant that rewrites text to be clearer and more accessible.

The user has selected text spanning ${selectedBlockUids.length} blocks: ["${uidList}"]
Selected text: "${selectedText}"

Surrounding page context:
${blockLines}

Rewrite EACH of the ${selectedBlockUids.length} selected blocks according to the user's instruction. Rewrite them independently but consistently in style.

Respond with ONLY valid JSON, no other text:
{"edits": [${editsSchema}]}`;
    } else {
      const uid = selectedBlockUids[0];
      systemPrompt = `You are a reading assistant that rewrites text to be clearer and more accessible.

The user has selected this text to rewrite: "${selectedText}"
It is in block [${uid}].

Surrounding page context:
${blockLines}

Rewrite the selected text according to the user's instruction. Keep the same meaning but make it clearer and simpler.

Respond with ONLY valid JSON, no other text:
{"uid": "${uid}", "editedText": "<your rewritten version>"}`;
    }
  } else {
    systemPrompt = `You are a reading assistant that answers questions about web page content.

Page text blocks (each with a unique ID):
${blockLines}
${selectionCtx}

The block marked "← USER SELECTION" is where the user is focused. Prioritize that block and its neighbors when answering. Answer the user's question concisely and clearly.

Respond with ONLY valid JSON, no other text:
{"uid": "<most relevant block id>", "answer": "<your answer>"}`;
  }

  (async () => {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: systemPrompt },
            ...messages,
          ],
          response_format: { type: "json_object" },
        }),
      });
      const data = await res.json();
      if (data.error) {
        sendResponse({ error: data.error.message });
        return;
      }
      const raw = data.choices[0].message.content;
      try {
        const parsed = JSON.parse(raw);
        sendResponse({ parsed, mode });
      } catch {
        sendResponse({ text: raw, mode });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true;
});
