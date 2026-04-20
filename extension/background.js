// Keep service worker alive by re-registering the listener each time
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR" });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "CHAT_REQUEST") return false;

  const { apiKey, selectedText, messages } = msg;

  const systemPrompt = selectedText
    ? `You are a reading assistant. The user has selected the following passage as context:\n\n"""\n${selectedText}\n"""\n\nAnswer their question about it concisely and clearly.`
    : "You are a helpful reading assistant. Be concise and clear.";

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
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
      });
      const data = await res.json();
      if (data.error) {
        sendResponse({ error: data.error.message });
      } else {
        sendResponse({ text: data.choices[0].message.content });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep channel open for async response
});
