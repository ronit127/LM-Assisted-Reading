let host = null;
let selectedText = "";
let currentRange = null;
let chatHistory = [];
let annotations = [];

const PAGE_KEY = `lm_annotations_${location.href}`;

// Re-inject saved annotations on load
chrome.storage.local.get(PAGE_KEY, (result) => {
  (result[PAGE_KEY] || []).forEach(restoreAnnotation);
});

// ── Sidebar ──────────────────────────────────────────────────────────────────

function createSidebar() {
  host = document.createElement("div");
  host.id = "lm-sidebar-host";
  const shadow = host.attachShadow({ mode: "closed" });
  host._shadow = shadow;
  shadow.appendChild(buildStyle());
  shadow.appendChild(buildUI());
  document.body.appendChild(host);
}

function removeSidebar() {
  if (host) { host.remove(); host = null; }
}


function buildStyle() {
  const s = document.createElement("style");
  s.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :host { all: initial; }

    #sidebar {
      position: fixed; top: 0; right: 0;
      width: 312px; height: 100vh;
      background: #FFFFFF;
      border-left: 1px solid rgba(0,0,0,0.09);
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #111110;
      z-index: 2147483647;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* ── Header ─────────────────────────────────────────── */
    #header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 14px;
      height: 44px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0;
      gap: 8px;
    }
    #header-title {
      font-size: 12px;
      font-weight: 500;
      color: #A3A29F;
      letter-spacing: 0.02em;
      flex: 1;
    }
    .hdr-actions { display: flex; align-items: center; gap: 1px; }
    .icon-btn {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px;
      background: none; border: none; cursor: pointer;
      border-radius: 5px;
      color: #A3A29F;
      transition: background 100ms ease, color 100ms ease;
      flex-shrink: 0;
    }
    .icon-btn:hover { background: rgba(0,0,0,0.06); color: #111110; }

    /* ── Settings ────────────────────────────────────────── */
    #settings-panel {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      background: #F9F9F8;
      flex-shrink: 0;
    }
    #settings-panel label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      color: #A3A29F;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 7px;
    }
    #api-key-input {
      width: 100%;
      padding: 7px 10px;
      background: #fff;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 6px;
      font-size: 12px;
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
      color: #111110;
      outline: none;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    #api-key-input::placeholder { color: #C9C8C5; }
    #api-key-input:focus {
      border-color: #5B5BD6;
      box-shadow: 0 0 0 2px rgba(91,91,214,0.12);
    }
    #save-key-btn {
      margin-top: 8px; width: 100%;
      padding: 7px 0;
      border: none; border-radius: 6px;
      background: #111110; color: #fff;
      font-size: 12px; font-weight: 500;
      font-family: inherit; cursor: pointer;
      letter-spacing: 0.01em;
      transition: background 100ms ease;
    }
    #save-key-btn:hover { background: #3D3C3A; }
    #key-status {
      margin-top: 6px;
      font-size: 11px;
      color: #A3A29F;
    }

    /* ── Context ─────────────────────────────────────────── */
    #context-section {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0;
    }
    #context-label {
      font-size: 10px;
      font-weight: 600;
      color: #A3A29F;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 7px;
    }
    #context-box {
      padding: 8px 10px 8px 11px;
      border-left: 2px solid rgba(0,0,0,0.2);
      background: #F4F4F3;
      border-radius: 0 5px 5px 0;
      font-size: 12px;
      line-height: 1.6;
      color: #3D3C3A;
      max-height: 88px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #context-placeholder {
      font-size: 12px;
      color: #C9C8C5;
      font-style: italic;
      line-height: 1.5;
    }

    /* ── Chat ────────────────────────────────────────────── */
    #chat-area {
      flex: 1;
      overflow-y: auto;
      padding: 16px 14px;
      display: flex;
      flex-direction: column;
      gap: 0;
      scroll-behavior: smooth;
    }
    #chat-area::-webkit-scrollbar { width: 3px; }
    #chat-area::-webkit-scrollbar-track { background: transparent; }
    #chat-area::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.10);
      border-radius: 3px;
    }

    .exchange { margin-bottom: 20px; }
    .exchange:last-child { margin-bottom: 0; }

    /* User turn */
    .turn-user {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 12px;
    }
    .bubble-user {
      max-width: 85%;
      padding: 8px 12px;
      background: #F1F0EF;
      border-radius: 12px 12px 3px 12px;
      font-size: 13px;
      line-height: 1.55;
      color: #111110;
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* Assistant turn */
    .turn-assistant { margin-bottom: 4px; }
    .assistant-label {
      font-size: 10px;
      font-weight: 600;
      color: #A3A29F;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 5px;
    }
    .bubble-assistant {
      font-size: 13px;
      line-height: 1.65;
      color: #111110;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* Error */
    .bubble-error {
      font-size: 12px;
      color: #C53030;
      padding: 8px 11px;
      background: #FFF5F5;
      border: 1px solid #FED7D7;
      border-radius: 6px;
      line-height: 1.5;
    }

    /* Thinking */
    .bubble-thinking {
      font-size: 12px;
      color: #A3A29F;
      font-style: italic;
    }

    /* Divider between exchanges */
    .exchange-sep {
      height: 1px;
      background: rgba(0,0,0,0.06);
      margin: 0 0 20px 0;
    }

    /* ── Input ───────────────────────────────────────────── */
    #input-bar {
      padding: 10px 14px 14px;
      border-top: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0;
    }
    #input-wrap {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      padding: 8px 8px 8px 12px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      background: #fff;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    #input-wrap:focus-within {
      border-color: #5B5BD6;
      box-shadow: 0 0 0 2px rgba(91,91,214,0.10);
    }
    #chat-input {
      flex: 1;
      background: none; border: none; outline: none; resize: none;
      font-size: 13px;
      font-family: inherit;
      color: #111110;
      line-height: 1.55;
      max-height: 120px;
      min-height: 20px;
      padding: 0;
    }
    #chat-input::placeholder { color: #C9C8C5; }
    #send-btn {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px;
      flex-shrink: 0;
      background: #111110;
      border: none;
      border-radius: 7px;
      cursor: pointer;
      color: #fff;
      transition: background 100ms ease;
    }
    #send-btn:hover { background: #3D3C3A; }
    #send-btn:disabled { background: #E3E2E0; cursor: not-allowed; }
  `;
  return s;
}

// ── UI ───────────────────────────────────────────────────────────────────────

function buildUI() {
  const sidebar = el("div", { id: "sidebar" });

  // Header
  const header = el("div", { id: "header" });
  header.appendChild(el("span", { id: "header-title", text: "Reading Assistant" }));
  const actions = el("div", { cls: "hdr-actions" });
  const settingsBtn = el("button", { cls: "icon-btn", title: "API key" });
  settingsBtn.innerHTML = svgGear();
  const closeBtn = el("button", { cls: "icon-btn", title: "Close" });
  closeBtn.innerHTML = svgClose();
  closeBtn.addEventListener("click", removeSidebar);
  actions.append(settingsBtn, closeBtn);
  header.append(el("span", { id: "header-title", text: "Reading Assistant" }), actions);
  // fix: clear before re-appending
  header.textContent = "";
  header.append(el("span", { id: "header-title", text: "Reading Assistant" }), actions);

  // Settings panel
  const settingsPanel = el("div", { id: "settings-panel" });
  const keyLabel = el("label", { text: "Groq API Key" });
  keyLabel.htmlFor = "api-key-input";
  const keyInput = el("input", { id: "api-key-input", type: "password", placeholder: "gsk_…" });
  const saveBtn = el("button", { id: "save-key-btn", text: "Save key" });
  const keyStatus = el("div", { id: "key-status" });
  settingsPanel.append(keyLabel, keyInput, saveBtn, keyStatus);
  settingsPanel.style.display = "none";

  settingsBtn.addEventListener("click", () => {
    settingsPanel.style.display = settingsPanel.style.display === "none" ? "" : "none";
  });
  saveBtn.addEventListener("click", () => {
    const val = keyInput.value.trim();
    if (!val) { keyStatus.textContent = "Enter a key first."; return; }
    chrome.storage.local.set({ apiKey: val }, () => {
      keyStatus.textContent = "Saved.";
      setTimeout(() => { keyStatus.textContent = ""; settingsPanel.style.display = "none"; }, 1200);
    });
  });
  chrome.storage.local.get("apiKey", ({ apiKey }) => {
    settingsPanel.style.display = apiKey ? "none" : "";
  });

  // Context
  const contextSection = el("div", { id: "context-section" });
  const contextLabel = el("div", { id: "context-label", text: "Context" });
  const contextBox = el("div", { id: "context-box" });
  contextBox.appendChild(el("span", { id: "context-placeholder", text: "Highlight text on the page to set context." }));
  contextSection.append(contextLabel, contextBox);

  // Chat area
  const chatArea = el("div", { id: "chat-area" });

  // Input
  const inputBar = el("div", { id: "input-bar" });
  const inputWrap = el("div", { id: "input-wrap" });
  const chatInput = el("textarea", { id: "chat-input", placeholder: "Ask about the selection…", rows: 1 });
  const sendBtn = el("button", { id: "send-btn", title: "Send" });
  sendBtn.innerHTML = svgSend();
  inputWrap.append(chatInput, sendBtn);
  inputBar.appendChild(inputWrap);

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener("click", sendMessage);

  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    chatInput.style.height = "auto";
    const rangeSnapshot = currentRange ? currentRange.cloneRange() : null;
    dispatchChat(text, chatArea, sendBtn, rangeSnapshot);
  }

  sidebar.append(header, settingsPanel, contextSection, chatArea, inputBar);
  return sidebar;
}

// ── Chat logic ───────────────────────────────────────────────────────────────

function dispatchChat(userText, chatArea, sendBtn, range) {
  // Separator between exchanges
  if (chatArea.children.length > 0) {
    chatArea.appendChild(el("div", { cls: "exchange-sep" }));
  }

  const exchange = el("div", { cls: "exchange" });

  // User bubble
  const turnUser = el("div", { cls: "turn-user" });
  turnUser.appendChild(el("div", { cls: "bubble-user", text: userText }));
  exchange.appendChild(turnUser);

  // Thinking
  const turnAssistant = el("div", { cls: "turn-assistant" });
  const aLabel = el("div", { cls: "assistant-label", text: "Assistant" });
  const aBody = el("div", { cls: "bubble-thinking", text: "Thinking…" });
  turnAssistant.append(aLabel, aBody);
  exchange.appendChild(turnAssistant);
  chatArea.appendChild(exchange);
  chatArea.scrollTop = chatArea.scrollHeight;

  chatHistory.push({ role: "user", content: userText });
  sendBtn.disabled = true;

  chrome.storage.local.get("apiKey", ({ apiKey }) => {
    if (!apiKey) {
      aBody.className = "bubble-error";
      aBody.textContent = "No API key — click the settings icon ⚙ to add one.";
      sendBtn.disabled = false;
      chatHistory.pop();
      return;
    }
    chrome.runtime.sendMessage(
      { type: "CHAT_REQUEST", apiKey, selectedText, messages: chatHistory },
      (resp) => {
        sendBtn.disabled = false;
        if (!resp || resp.error) {
          aBody.className = "bubble-error";
          aBody.textContent = resp?.error || "Unknown error.";
          chatHistory.pop();
        } else {
          aBody.className = "bubble-assistant";
          aBody.textContent = resp.text;
          chatArea.scrollTop = chatArea.scrollHeight;
          chatHistory.push({ role: "assistant", content: resp.text });
          if (range) injectAnnotation({ id: uid(), selectedText, question: userText, answer: resp.text }, range);
        }
      }
    );
  });
}

// ── Inline annotation ────────────────────────────────────────────────────────

function injectAnnotation(data, range) {
  let markEl = null;
  try {
    markEl = document.createElement("mark");
    markEl.className = "lm-highlight";
    markEl.style.cssText = "background:#E8E7E5; border-radius:2px; padding:0 1px; color:inherit;";
    range.surroundContents(markEl);
  } catch (_) {
    markEl = null;
  }

  const card = buildAnnotationCard(data, markEl);
  const anchor = markEl?.parentNode ? markEl : getBlockAncestor(range.commonAncestorContainer);
  anchor.parentNode.insertBefore(card, anchor.nextSibling);

  annotations.push({ ...data, cardEl: card, markEl });
  saveAnnotations();
}

function restoreAnnotation(data) {
  const range = findTextInDOM(data.selectedText);
  if (!range) return;

  let markEl = null;
  try {
    markEl = document.createElement("mark");
    markEl.className = "lm-highlight";
    markEl.style.cssText = "background:#E8E7E5; border-radius:2px; padding:0 1px; color:inherit;";
    range.surroundContents(markEl);
  } catch (_) {
    markEl = null;
  }

  const card = buildAnnotationCard(data, markEl);
  const anchor = markEl?.parentNode ? markEl : getBlockAncestor(range.commonAncestorContainer);
  anchor.parentNode.insertBefore(card, anchor.nextSibling);
  annotations.push({ ...data, cardEl: card, markEl });
}

function buildAnnotationCard(data, markEl) {
  const card = document.createElement("div");
  card.className = "lm-annotation";
  card.style.cssText = `
    all: initial;
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    margin: 6px 0 8px 0;
    border-radius: 6px;
    background: #F9F9F8;
    border: 1px solid rgba(0,0,0,0.09);
    border-left: 2px solid rgba(0,0,0,0.25);
    position: relative;
    overflow: hidden;
  `;

  const inner = document.createElement("div");
  inner.style.cssText = "padding: 9px 32px 9px 11px;";

  const qEl = document.createElement("div");
  qEl.style.cssText = `
    font-size: 10px; font-weight: 600; color: #6F6E6B;
    letter-spacing: 0.08em; text-transform: uppercase;
    margin-bottom: 4px; font-family: inherit; line-height: 1.4;
  `;
  qEl.textContent = data.question;

  const aEl = document.createElement("div");
  aEl.style.cssText = `
    font-size: 12.5px; line-height: 1.62; color: #111110;
    white-space: pre-wrap; word-break: break-word; font-family: inherit;
  `;
  aEl.textContent = data.answer;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = `
    position: absolute; top: 7px; right: 7px;
    width: 18px; height: 18px;
    background: none; border: none; cursor: pointer;
    color: #C9C8C5; font-size: 15px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    border-radius: 3px; font-family: inherit; padding: 0;
    transition: color 80ms, background 80ms;
  `;
  closeBtn.textContent = "×";
  closeBtn.onmouseover = () => { closeBtn.style.color = "#6F6E6B"; closeBtn.style.background = "rgba(0,0,0,0.06)"; };
  closeBtn.onmouseout  = () => { closeBtn.style.color = "#C9C8C5"; closeBtn.style.background = "none"; };
  closeBtn.addEventListener("click", () => {
    card.remove();
    if (markEl) unwrapHighlight(markEl);
    annotations = annotations.filter((a) => a.cardEl !== card);
    saveAnnotations();
  });

  inner.append(qEl, aEl);
  card.append(inner, closeBtn);
  return card;
}

// ── Persistence ──────────────────────────────────────────────────────────────

function saveAnnotations() {
  const data = annotations.map(({ id, selectedText, question, answer }) => ({
    id, selectedText, question, answer,
  }));
  chrome.storage.local.set({ [PAGE_KEY]: data });
}

// ── DOM utils ────────────────────────────────────────────────────────────────

function findTextInDOM(searchText) {
  if (!searchText) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const idx = node.textContent.indexOf(searchText);
    if (idx !== -1) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + searchText.length);
      return range;
    }
  }
  return null;
}

function getBlockAncestor(node) {
  const BLOCK = new Set(["P","DIV","LI","UL","OL","H1","H2","H3","H4","H5","H6",
    "BLOCKQUOTE","TD","TH","SECTION","ARTICLE","HEADER","FOOTER","MAIN","FIGURE"]);
  let e = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (e && !BLOCK.has(e.tagName)) e = e.parentElement;
  return e || (node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
}

function unwrapHighlight(mark) {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
  parent.normalize();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Selection listener ───────────────────────────────────────────────────────

document.addEventListener("selectionchange", () => {
  if (!host) return;
  const sel = window.getSelection();
  if (sel?.anchorNode && host.contains(sel.anchorNode)) return;
  const text = sel.toString().trim();
  if (!text) return;

  selectedText = text;
  currentRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

  const contextBox = host._shadow.getElementById("context-box");
  contextBox.textContent = text;
  contextBox.style.color = "#3D3C3A";
});

// ── Toggle ───────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "TOGGLE_SIDEBAR") return;
  if (host) { removeSidebar(); } else { createSidebar(); }
});

// ── Icons ────────────────────────────────────────────────────────────────────

function svgGear() {
  return `<svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.07095 0.650238C6.67391 0.650238 6.32977 0.925096 6.24198 1.31231L6.0039 2.36247C5.6249 2.47269 5.26335 2.62696 4.92816 2.82081L3.99319 2.2393C3.66069 2.03114 3.23126 2.07475 2.94395 2.36206L2.36206 2.94395C2.07475 3.23126 2.03114 3.66069 2.2393 3.99319L2.82081 4.92816C2.62696 5.26335 2.47269 5.6249 2.36247 6.0039L1.31231 6.24198C0.925096 6.32977 0.650238 6.67391 0.650238 7.07095V7.92905C0.650238 8.32609 0.925096 8.67023 1.31231 8.75802L2.36247 8.9961C2.47269 9.3751 2.62696 9.73665 2.82081 10.0718L2.2393 11.0068C2.03114 11.3393 2.07475 11.7687 2.36206 12.056L2.94395 12.6379C3.23126 12.9253 3.66069 12.9689 3.99319 12.7607L4.92816 12.1792C5.26335 12.373 5.6249 12.5273 6.0039 12.6375L6.24198 13.6877C6.32977 14.0749 6.67391 14.3498 7.07095 14.3498H7.92905C8.32609 14.3498 8.67023 14.0749 8.75802 13.6877L8.9961 12.6375C9.3751 12.5273 9.73665 12.373 10.0718 12.1792L11.0068 12.7607C11.3393 12.9689 11.7687 12.9253 12.056 12.6379L12.6379 12.056C12.9253 11.7687 12.9689 11.3393 12.7607 11.0068L12.1792 10.0718C12.373 9.73665 12.5273 9.3751 12.6375 8.9961L13.6877 8.75802C14.0749 8.67023 14.3498 8.32609 14.3498 7.92905V7.07095C14.3498 6.67391 14.0749 6.32977 13.6877 6.24198L12.6375 6.0039C12.5273 5.6249 12.373 5.26335 12.1792 4.92816L12.7607 3.99319C12.9689 3.66069 12.9253 3.23126 12.6379 2.94395L12.056 2.36206C11.7687 2.07475 11.3393 2.03114 11.0068 2.2393L10.0718 2.82081C9.73665 2.62696 9.3751 2.47269 8.9961 2.36247L8.75802 1.31231C8.67023 0.925096 8.32609 0.650238 7.92905 0.650238H7.07095ZM4.95 7.5C4.95 6.0812 6.0812 4.95 7.5 4.95C8.9188 4.95 10.05 6.0812 10.05 7.5C10.05 8.9188 8.9188 10.05 7.5 10.05C6.0812 10.05 4.95 8.9188 4.95 7.5Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgClose() {
  return `<svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgSend() {
  return `<svg width="13" height="13" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.20308 1.04312C1.00481 0.954998 0.772341 1.0048 0.627577 1.16641C0.482813 1.32802 0.458794 1.56455 0.568117 1.75196L3.92115 7.50002L0.568117 13.2481C0.458794 13.4355 0.482813 13.672 0.627577 13.8336C0.772341 13.9952 1.00481 14.045 1.20308 13.9569L14.7031 7.95693C14.8836 7.87668 15 7.69762 15 7.50002C15 7.30243 14.8836 7.12337 14.7031 7.04312L1.20308 1.04312Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

// ── el factory ───────────────────────────────────────────────────────────────

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.id)          e.id = opts.id;
  if (opts.cls)         e.className = opts.cls;
  if (opts.text)        e.textContent = opts.text;
  if (opts.type)        e.type = opts.type;
  if (opts.placeholder) e.placeholder = opts.placeholder;
  if (opts.rows)        e.rows = opts.rows;
  if (opts.style)       e.style.cssText = opts.style;
  if (opts.title)       e.title = opts.title;
  return e;
}
