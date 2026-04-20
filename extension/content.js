let host = null;
let selectedText = "";
let currentRange = null;
let chatHistory = [];
let displayHistory = []; // [{userText, assistantText, mode}]
let annotations = [];
let currentMode = 'ask';

const PAGE_KEY    = `lm_annotations_${location.href}`;
const SESSION_KEY = `lm_session_${location.href}`;

chrome.storage.local.get(PAGE_KEY, (result) => {
  (result[PAGE_KEY] || []).forEach(restoreAnnotation);
});


let uidCounter = 0;
const originalTexts = new Map();

function assignUIDs() {
  document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th').forEach(el => {
    if (!el.dataset.lmUid) {
      el.dataset.lmUid = `b${uidCounter++}`;
    }
    if (!originalTexts.has(el.dataset.lmUid)) {
      originalTexts.set(el.dataset.lmUid, el.textContent);
    }
  });
}

function findBlocksForRange(range) {
  if (!range) return [];
  const uids = [];
  document.querySelectorAll('[data-lm-uid]').forEach(el => {
    if (range.intersectsNode(el)) uids.push(el.dataset.lmUid);
  });
  if (uids.length === 0) {
    const rangeRect = range.getBoundingClientRect();
    let closest = null, closestDist = Infinity;
    document.querySelectorAll('[data-lm-uid]').forEach(el => {
      const rect = el.getBoundingClientRect();
      const dist = Math.abs((rect.top + rect.height / 2) - (rangeRect.top + rangeRect.height / 2));
      if (dist < closestDist) { closestDist = dist; closest = el; }
    });
    if (closest) uids.push(closest.dataset.lmUid);
  }
  return uids;
}

function getPageBlocks(selectedUids = []) {
  const selectedSet = new Set(selectedUids);
  const blocks = [];
  document.querySelectorAll('[data-lm-uid]').forEach(el => {
    const uid = el.dataset.lmUid;
    const rawText = originalTexts.has(uid) ? originalTexts.get(uid) : el.textContent;
    const text = rawText.trim();
    if (text.length > 15) {
      blocks.push({
        uid: uid,
        text: text.slice(0, 400),
        isSelected: selectedSet.has(uid),
      });
    }
  });
  return blocks.slice(0, 80);
}


function createSidebar() {
  assignUIDs();
  host = document.createElement("div");
  host.id = "lm-sidebar-host";
  const shadow = host.attachShadow({ mode: "closed" });
  host._shadow = shadow;
  shadow.appendChild(buildStyle());
  shadow.appendChild(buildUI());
  document.body.appendChild(host);

  chrome.storage.local.get([SESSION_KEY, 'sidebarCollapsed'], (result) => {
    const session  = result[SESSION_KEY];
    const sidebarEl   = shadow.getElementById("sidebar");
    const chatArea    = shadow.getElementById("chat-area");
    const contextBox  = shadow.getElementById("context-box");
    const collapseBtn = shadow.getElementById("collapse-btn");

    if (session) {
      chatHistory    = session.chatHistory    || [];
      displayHistory = session.displayHistory || [];

      if (session.savedSelectedText && contextBox) {
        selectedText = session.savedSelectedText;
        contextBox.textContent = selectedText;
        contextBox.style.color = "#3D3C3A";
      }

      displayHistory.forEach(item => renderExchange(item, chatArea));
      if (chatArea.children.length > 0) chatArea.scrollTop = chatArea.scrollHeight;
    }

    if (result.sidebarCollapsed && sidebarEl) {
      sidebarEl.classList.add('collapsed');
      if (collapseBtn) collapseBtn.innerHTML = svgChevronLeft();
    }
  });
}

function removeSidebar() {
  if (host) {
    if (host._cleanup) {
      host._cleanup.forEach(fn => fn());
    }
    chrome.storage.local.set({
      [SESSION_KEY]: { chatHistory, displayHistory, savedSelectedText: selectedText }
    });
    host.remove();
    host = null;
  }
}

function buildStyle() {
  const s = document.createElement("style");
  s.textContent = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }

    #sidebar {
      position: fixed; top: 20px; right: 20px;
      width: 320px; height: 600px; max-height: calc(100vh - 40px);
      background: #FAFAF9;
      border: 1px solid rgba(0,0,0,0.15);
      border-radius: 12px;
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 13px; line-height: 1.5; color: #111110;
      z-index: 2147483647;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      overflow: hidden;
      user-select: none;
      -webkit-user-select: none;
      resize: both;
      min-width: 280px;
      min-height: 200px;
    }
    /* Re-enable selection only for actual input fields */
    #chat-input, #api-key-input {
      user-select: text;
      -webkit-user-select: text;
    }
    #sidebar.collapsed { height: 44px !important; min-height: 44px !important; resize: none; }

    /* Header */
    #header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 14px; height: 44px; min-height: 44px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0; gap: 8px;
      cursor: grab;
    }
    #header:active { cursor: grabbing; }
    #header-title { font-size: 12px; font-weight: 600; color: #111110; letter-spacing: -0.01em; flex: 1; }
    .hdr-actions { display: flex; align-items: center; gap: 1px; }
    .icon-btn {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px;
      background: none; border: none; cursor: pointer;
      border-radius: 5px; color: #A3A29F;
      transition: background 100ms, color 100ms;
    }
    .icon-btn:hover { background: rgba(0,0,0,0.06); color: #111110; }

    /* Sidebar body — everything below the header */
    #sidebar-body {
      flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0;
    }

    /* Settings */
    #settings-panel {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      background: #F4F4F3; flex-shrink: 0;
    }
    #settings-panel label {
      display: block; font-size: 10px; font-weight: 600; color: #A3A29F;
      text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 7px;
    }
    #api-key-input {
      width: 100%; padding: 7px 10px;
      background: #fff; border: 1px solid rgba(0,0,0,0.12);
      border-radius: 6px; font-size: 12px;
      font-family: "SF Mono", "Fira Code", monospace;
      color: #111110; outline: none;
      transition: border-color 120ms, box-shadow 120ms;
    }
    #api-key-input::placeholder { color: #C9C8C5; }
    #api-key-input:focus { border-color: #5B5BD6; box-shadow: 0 0 0 2px rgba(91,91,214,0.12); }
    #save-key-btn {
      margin-top: 8px; width: 100%; padding: 7px 0;
      border: none; border-radius: 6px;
      background: #111110; color: #fff;
      font-size: 12px; font-weight: 500; font-family: inherit;
      cursor: pointer; transition: background 100ms;
    }
    #save-key-btn:hover { background: #3D3C3A; }
    #key-status { margin-top: 6px; font-size: 11px; color: #A3A29F; }

    /* Context */
    #context-section {
      padding: 10px 14px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0;
    }
    #context-label-row {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 6px;
    }
    #context-label {
      font-size: 10px; font-weight: 600; color: #A3A29F;
      text-transform: uppercase; letter-spacing: 0.1em;
    }
    #clear-selection-btn {
      font-size: 10px; font-weight: 600; color: #A3A29F;
      background: none; border: none; cursor: pointer;
      text-transform: uppercase; letter-spacing: 0.05em;
      transition: color 100ms; padding: 0;
    }
    #clear-selection-btn:hover { color: #C53030; }
    #context-box {
      padding: 7px 10px 7px 11px;
      border-left: 2px solid rgba(91,91,214,0.4);
      background: rgba(91,91,214,0.06); border-radius: 0 5px 5px 0;
      font-size: 12px; line-height: 1.6; color: #3D3C3A;
      max-height: 72px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    #context-placeholder { font-size: 12px; color: #C9C8C5; font-style: italic; }

    /* Chat */
    #chat-area {
      flex: 1; overflow-y: auto;
      padding: 14px;
      display: flex; flex-direction: column; gap: 0;
      scroll-behavior: smooth;
    }
    #chat-area::-webkit-scrollbar { width: 3px; }
    #chat-area::-webkit-scrollbar-track { background: transparent; }
    #chat-area::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.10); border-radius: 3px; }

    .exchange { margin-bottom: 18px; }
    .exchange:last-child { margin-bottom: 0; }

    .turn-user { display: flex; justify-content: flex-end; margin-bottom: 10px; }
    .bubble-user {
      max-width: 85%; padding: 7px 11px;
      background: #111110; color: #fff;
      border-radius: 12px 12px 3px 12px;
      font-size: 12.5px; line-height: 1.55; word-break: break-word;
    }

    .turn-assistant { margin-bottom: 4px; }
    .assistant-label {
      font-size: 10px; font-weight: 600; color: #A3A29F;
      text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;
    }
    .bubble-assistant {
      font-size: 13px; line-height: 1.65; color: #111110;
      white-space: pre-wrap; word-break: break-word;
    }
    .bubble-error {
      font-size: 12px; color: #C53030; padding: 8px 11px;
      background: #FFF5F5; border: 1px solid #FED7D7; border-radius: 6px; line-height: 1.5;
    }
    .bubble-thinking { font-size: 12px; color: #A3A29F; font-style: italic; }
    .bubble-edit-confirm {
      font-size: 12px; color: #92400E; padding: 7px 11px;
      background: #FFFBEB; border: 1px solid rgba(217,119,6,0.3);
      border-left: 2px solid #D97706; border-radius: 0 6px 6px 0; line-height: 1.5;
    }
    .exchange-sep { height: 1px; background: rgba(0,0,0,0.06); margin: 0 0 18px 0; }

    /* Input */
    #input-bar { padding: 10px 14px 14px; border-top: 1px solid rgba(0,0,0,0.07); flex-shrink: 0; }

    /* Mode toggle */
    #mode-toggle { display: flex; gap: 4px; margin-bottom: 8px; }
    .mode-btn {
      flex: 1; padding: 5px 0;
      border: 1px solid rgba(0,0,0,0.12); border-radius: 6px;
      background: transparent; font-size: 11px; font-weight: 500;
      color: #6F6E6B; cursor: pointer; font-family: inherit;
      letter-spacing: 0.02em; transition: all 120ms ease;
    }
    .mode-btn:hover:not(.active) { background: rgba(0,0,0,0.04); }
    .mode-btn.active.ask-btn { background: #5B5BD6; border-color: #5B5BD6; color: white; }
    .mode-btn.active.edit-btn { background: #D97706; border-color: #D97706; color: white; }

    #input-wrap {
      display: flex; align-items: flex-end; gap: 8px;
      padding: 8px 8px 8px 12px;
      border: 1px solid rgba(0,0,0,0.12); border-radius: 10px; background: #fff;
      transition: border-color 120ms, box-shadow 120ms;
    }
    #input-wrap:focus-within { border-color: #5B5BD6; box-shadow: 0 0 0 2px rgba(91,91,214,0.10); }
    #input-wrap.edit-mode:focus-within { border-color: #D97706; box-shadow: 0 0 0 2px rgba(217,119,6,0.10); }

    #chat-input {
      flex: 1; background: none; border: none; outline: none; resize: none;
      font-size: 13px; font-family: inherit; color: #111110;
      line-height: 1.55; max-height: 120px; min-height: 20px; padding: 0;
    }
    #chat-input::placeholder { color: #C9C8C5; }
    #send-btn {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; flex-shrink: 0;
      background: #111110; border: none; border-radius: 7px;
      cursor: pointer; color: #fff; transition: background 100ms;
    }
    #send-btn:hover { background: #3D3C3A; }
    #send-btn:disabled { background: #E3E2E0; cursor: not-allowed; }
    #send-btn.edit-mode { background: #D97706; }
    #send-btn.edit-mode:hover { background: #B45309; }
  `;
  return s;
}


function buildUI() {
  const sidebar = el("div", { id: "sidebar" });

  const header = el("div", { id: "header" });
  const actions = el("div", { cls: "hdr-actions" });

  const collapseBtn = el("button", { id: "collapse-btn", cls: "icon-btn", title: "Collapse" });
  collapseBtn.innerHTML = svgChevronRight();

  const settingsBtn = el("button", { cls: "icon-btn", title: "API key" });
  settingsBtn.innerHTML = svgGear();

  const clearBtn = el("button", { cls: "icon-btn", title: "New chat" });
  clearBtn.innerHTML = svgTrash();

  const closeBtn = el("button", { cls: "icon-btn", title: "Close" });
  closeBtn.innerHTML = svgClose();
  closeBtn.addEventListener("click", removeSidebar);

  actions.append(collapseBtn, settingsBtn, clearBtn, closeBtn);
  header.append(el("span", { id: "header-title", text: "Reading Assistant" }), actions);

  collapseBtn.addEventListener("click", () => {
    sidebar.style.transition = 'height 260ms cubic-bezier(0.4, 0, 0.2, 1)';
    const isCollapsed = sidebar.classList.toggle('collapsed');
    collapseBtn.innerHTML = isCollapsed ? svgChevronLeft() : svgChevronRight();
    chrome.storage.local.set({ sidebarCollapsed: isCollapsed });
    setTimeout(() => { sidebar.style.transition = 'none'; }, 260);
  });

  let isDragging = false;
  let offsetX, offsetY;
  let initialTransition = sidebar.style.transition || '';

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest('.hdr-actions')) return;
    isDragging = true;
    const rect = sidebar.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    
    sidebar.style.width = rect.width + 'px';
    sidebar.style.height = rect.height + 'px';
    sidebar.style.transition = 'none';
  });

  const onMouseMove = (e) => {
    if (!isDragging) return;
    sidebar.style.left = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - sidebar.offsetWidth)) + 'px';
    sidebar.style.top = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - sidebar.offsetHeight)) + 'px';
    sidebar.style.right = 'auto';
  };

  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      sidebar.style.transition = initialTransition; 
    }
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  if (host) {
    host._cleanup = host._cleanup || [];
    host._cleanup.push(() => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    });
  }

  const body = el("div", { id: "sidebar-body" });

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

  const contextSection = el("div", { id: "context-section" });
  const contextBox = el("div", { id: "context-box" });
  contextBox.appendChild(el("span", { id: "context-placeholder", text: "Highlight text on the page to set context." }));
  
  const ctxLabelRow = el("div", { id: "context-label-row" });
  const ctxLabel = el("div", { id: "context-label", text: "Selection" });
  const clearSelectionBtn = el("button", { id: "clear-selection-btn", text: "Clear", title: "Clear current selection" });
  
  clearSelectionBtn.addEventListener("click", () => {
    selectedText = "";
    currentRange = null;
    contextBox.textContent = "";
    contextBox.appendChild(el("span", { id: "context-placeholder", text: "Highlight text on the page to set context." }));
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  });
  
  ctxLabelRow.append(ctxLabel, clearSelectionBtn);
  contextSection.append(ctxLabelRow, contextBox);

  const chatArea = el("div", { id: "chat-area" });

  clearBtn.addEventListener("click", () => {
    chatHistory = [];
    displayHistory = [];
    selectedText = "";
    currentRange = null;
    chatArea.innerHTML = "";
    contextBox.textContent = "";
    contextBox.appendChild(el("span", { id: "context-placeholder", text: "Highlight text on the page to set context." }));
    chrome.storage.local.remove(SESSION_KEY);
  });

  const inputBar = el("div", { id: "input-bar" });

  const modeToggle = el("div", { id: "mode-toggle" });
  const askBtn  = el("button", { cls: "mode-btn ask-btn active",  text: "Ask"  });
  const editBtn = el("button", { cls: "mode-btn edit-btn",        text: "Edit" });
  modeToggle.append(askBtn, editBtn);

  const inputWrap = el("div",      { id: "input-wrap" });
  const chatInput = el("textarea", { id: "chat-input", placeholder: "Ask about the selection…", rows: 1 });
  const sendBtn   = el("button",   { id: "send-btn", title: "Send" });
  sendBtn.innerHTML = svgSend();
  inputWrap.append(chatInput, sendBtn);
  inputBar.append(modeToggle, inputWrap);

  askBtn.addEventListener("click", () => {
    currentMode = 'ask';
    askBtn.classList.add("active"); editBtn.classList.remove("active");
    chatInput.placeholder = "Ask about the selection…";
    sendBtn.classList.remove("edit-mode");
    inputWrap.classList.remove("edit-mode");
  });
  editBtn.addEventListener("click", () => {
    currentMode = 'edit';
    editBtn.classList.add("active"); askBtn.classList.remove("active");
    chatInput.placeholder = "Simplify, rewrite, or clarify…";
    sendBtn.classList.add("edit-mode");
    inputWrap.classList.add("edit-mode");
  });

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

  body.append(settingsPanel, contextSection, chatArea, inputBar);
  sidebar.append(header, body);
  return sidebar;
}

function renderExchange(item, chatArea) {
  if (chatArea.children.length > 0) chatArea.appendChild(el("div", { cls: "exchange-sep" }));
  const exchange = el("div", { cls: "exchange" });
  const turnUser = el("div", { cls: "turn-user" });
  turnUser.appendChild(el("div", { cls: "bubble-user", text: item.userText }));
  exchange.appendChild(turnUser);
  const turnAssistant = el("div", { cls: "turn-assistant" });
  turnAssistant.appendChild(el("div", { cls: "assistant-label", text: "Assistant" }));
  turnAssistant.appendChild(el("div", {
    cls: item.mode === 'edit' ? "bubble-edit-confirm" : "bubble-assistant",
    text: item.assistantText,
  }));
  exchange.appendChild(turnAssistant);
  chatArea.appendChild(exchange);
}

function dispatchChat(userText, chatArea, sendBtn, range) {
  if (chatArea.children.length > 0) chatArea.appendChild(el("div", { cls: "exchange-sep" }));

  const exchange = el("div", { cls: "exchange" });
  const turnUser = el("div", { cls: "turn-user" });
  turnUser.appendChild(el("div", { cls: "bubble-user", text: userText }));
  exchange.appendChild(turnUser);

  const turnAssistant = el("div", { cls: "turn-assistant" });
  const aLabel = el("div", { cls: "assistant-label", text: "Assistant" });
  const aBody  = el("div", { cls: "bubble-thinking", text: "Thinking…" });
  turnAssistant.append(aLabel, aBody);
  exchange.appendChild(turnAssistant);
  chatArea.appendChild(exchange);
  chatArea.scrollTop = chatArea.scrollHeight;

  chatHistory.push({ role: "user", content: userText });
  sendBtn.disabled = true;

  const mode = currentMode;
  const selectedBlockUids = findBlocksForRange(range);

  if (mode === 'edit' && selectedBlockUids.length === 0) {
    aBody.className = "bubble-error";
    aBody.textContent = "Highlight the text you want to rewrite, then try again.";
    sendBtn.disabled = false;
    chatHistory.pop();
    return;
  }

  const blocks = getPageBlocks(selectedBlockUids);

  chrome.storage.local.get("apiKey", ({ apiKey }) => {
    if (!apiKey) {
      aBody.className = "bubble-error";
      aBody.textContent = "No API key — click ⚙ to add one.";
      sendBtn.disabled = false;
      chatHistory.pop();
      return;
    }

    chrome.runtime.sendMessage(
      { type: "CHAT_REQUEST", apiKey, selectedText, messages: chatHistory, blocks, mode, selectedBlockUids },
      (resp) => {
        sendBtn.disabled = false;
        if (!resp || resp.error) {
          aBody.className = "bubble-error";
          aBody.textContent = resp?.error || "Unknown error.";
          chatHistory.pop();
          return;
        }

        const parsed = resp.parsed;

        if (mode === 'edit' && (parsed?.edits || parsed?.editedText)) {
          const edits = parsed.edits ||
            [{ uid: selectedBlockUids[0] || parsed.uid, editedText: parsed.editedText }];
          const preview = edits[0]?.editedText?.slice(0, 60) || "";
          const confirmText = `✦ Rewritten ${edits.length > 1 ? `(${edits.length} blocks)` : ""} — "${preview}…"`;
          aBody.className = "bubble-edit-confirm";
          aBody.textContent = confirmText;
          chatHistory.push({ role: "assistant", content: edits.map(e => e.editedText).join('\n\n') });
          displayHistory.push({ userText, assistantText: confirmText, mode: 'edit' });
          edits.forEach((edit, i) => {
            const targetUid = selectedBlockUids[i] ?? edit.uid;
            applyEdit(targetUid, edit.editedText);
          });

        } else if (mode === 'ask' && parsed?.answer) {
          const { uid, answer } = parsed;
          aBody.className = "bubble-assistant";
          aBody.textContent = answer;
          chatHistory.push({ role: "assistant", content: answer });
          displayHistory.push({ userText, assistantText: answer, mode: 'ask' });
          chatArea.scrollTop = chatArea.scrollHeight;
          injectAnnotation({ id: genId(), selectedText, question: userText, answer, uid: uid || selectedBlockUids[0] || null }, range);

        } else {
          const text = resp.text || (parsed ? JSON.stringify(parsed) : "No response.");
          aBody.className = "bubble-assistant";
          aBody.textContent = text;
          chatHistory.push({ role: "assistant", content: text });
          displayHistory.push({ userText, assistantText: text, mode: 'ask' });
          chatArea.scrollTop = chatArea.scrollHeight;
          if (range) injectAnnotation({ id: genId(), selectedText, question: userText, answer: text, uid: null }, range);
        }
      }
    );
  });
}


function injectAnnotation(data, range) {
  let markEl = null;
  if (range) {
    try {
      markEl = document.createElement("mark");
      markEl.className = "lm-highlight";
      markEl.style.cssText = "background: rgba(91,91,214,0.15); border-radius: 2px; padding: 0 1px; color: inherit;";
      range.surroundContents(markEl);
    } catch (_) { markEl = null; }
  }

  let targetEl = null;
  if (data.uid) targetEl = document.querySelector(`[data-lm-uid="${data.uid}"]`);
  if (!targetEl && markEl?.parentNode) targetEl = getBlockAncestor(markEl);
  if (!targetEl && range) targetEl = getBlockAncestor(range.commonAncestorContainer);
  if (!targetEl) return;

  const card = buildAnnotationCard(data, markEl);
  targetEl.parentNode.insertBefore(card, targetEl.nextSibling);

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
    markEl.style.cssText = "background: rgba(91,91,214,0.15); border-radius: 2px; padding: 0 1px; color: inherit;";
    range.surroundContents(markEl);
  } catch (_) { markEl = null; }

  let targetEl = null;
  if (data.uid) targetEl = document.querySelector(`[data-lm-uid="${data.uid}"]`);
  if (!targetEl && markEl?.parentNode) targetEl = getBlockAncestor(markEl);
  if (!targetEl) targetEl = getBlockAncestor(range.commonAncestorContainer);
  if (!targetEl) return;

  const card = buildAnnotationCard(data, markEl);
  targetEl.parentNode.insertBefore(card, targetEl.nextSibling);
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
    margin: 8px 0 10px 0;
    border-radius: 0 7px 7px 0;
    background: rgba(91,91,214,0.05);
    border: 1px solid rgba(91,91,214,0.15);
    border-left: 3px solid #5B5BD6;
    position: relative;
  `;

  const inner = document.createElement("div");
  inner.style.cssText = "padding: 10px 36px 10px 12px;";

  const qEl = document.createElement("div");
  qEl.style.cssText = `
    font-size: 10px; font-weight: 600; color: #5B5BD6;
    letter-spacing: 0.06em; text-transform: uppercase;
    margin-bottom: 5px; font-family: inherit; line-height: 1.4;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  `;
  qEl.textContent = data.question;

  const aEl = document.createElement("div");
  aEl.style.cssText = `
    font-size: 12.5px; line-height: 1.65; color: #1C1C3A;
    white-space: pre-wrap; word-break: break-word; font-family: inherit;
  `;
  aEl.textContent = data.answer;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = `
    position: absolute; top: 8px; right: 8px;
    width: 18px; height: 18px;
    background: none; border: none; cursor: pointer;
    color: rgba(91,91,214,0.35); font-size: 15px; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    border-radius: 3px; font-family: inherit; padding: 0;
    transition: color 80ms, background 80ms;
  `;
  closeBtn.textContent = "×";
  closeBtn.onmouseover = () => { closeBtn.style.color = "#5B5BD6"; closeBtn.style.background = "rgba(91,91,214,0.08)"; };
  closeBtn.onmouseout  = () => { closeBtn.style.color = "rgba(91,91,214,0.35)"; closeBtn.style.background = "none"; };
  closeBtn.addEventListener("click", () => {
    card.remove();
    if (markEl) unwrapHighlight(markEl);
    annotations = annotations.filter(a => a.cardEl !== card);
    saveAnnotations();
  });

  inner.append(qEl, aEl);
  card.append(inner, closeBtn);
  return card;
}

function applyEdit(uid, editedText) {
  const targetEl = uid ? document.querySelector(`[data-lm-uid="${uid}"]`) : null;
  if (!targetEl) return;

  const originalText = originalTexts.has(uid) ? originalTexts.get(uid) : targetEl.textContent;

  const badge = document.createElement("div");
  badge.style.cssText = `
    all: initial;
    display: flex; align-items: center; gap: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 11px; font-weight: 500;
    color: #92400E; background: #FFFBEB;
    border: 1px solid rgba(217,119,6,0.25); border-left: 3px solid #D97706;
    border-radius: 0 5px 5px 0;
    padding: 5px 10px; margin-bottom: 4px;
    -webkit-font-smoothing: antialiased;
  `;

  const label = document.createElement("span");
  label.textContent = "✦ AI simplified";
  label.style.flex = "1";

  const restoreBtn = document.createElement("button");
  restoreBtn.textContent = "Restore";
  restoreBtn.style.cssText = `
    background: none; border: 1px solid rgba(217,119,6,0.4);
    border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;
    color: #92400E; font-family: inherit; padding: 2px 7px;
    transition: background 100ms;
  `;
  restoreBtn.onmouseover = () => { restoreBtn.style.background = "rgba(217,119,6,0.08)"; };
  restoreBtn.onmouseout  = () => { restoreBtn.style.background = "none"; };
  restoreBtn.addEventListener("click", () => {
    targetEl.textContent = originalText;
    badge.remove();
  });

  badge.append(label, restoreBtn);
  targetEl.textContent = editedText;
  targetEl.parentNode.insertBefore(badge, targetEl);
}

function saveAnnotations() {
  const data = annotations.map(({ id, selectedText, question, answer, uid }) => ({
    id, selectedText, question, answer, uid,
  }));
  chrome.storage.local.set({ [PAGE_KEY]: data });
}

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

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

document.addEventListener("selectionchange", () => {
  if (!host) return;
  
  if (document.activeElement === host) return;

  const sel = window.getSelection();
  if (sel?.anchorNode && (host.contains(sel.anchorNode) || host._shadow?.contains(sel.anchorNode))) return;
  
  const text = sel.toString().trim();
  if (!text) return;

  selectedText = text;
  currentRange = sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;

  const contextBox = host._shadow.getElementById("context-box");
  if (contextBox) {
    contextBox.textContent = text;
    contextBox.style.color = "#3D3C3A";
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "TOGGLE_SIDEBAR") return;
  if (host) { removeSidebar(); } else { createSidebar(); }
});

function svgChevronRight() {
  return `<svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgChevronLeft() {
  return `<svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M8.84182 3.13514C9.04327 3.32401 9.05348 3.64043 8.86462 3.84188L5.43521 7.49991L8.86462 11.1579C9.05348 11.3594 9.04327 11.6758 8.84182 11.8647C8.64036 12.0535 8.32394 12.0433 8.13508 11.8419L4.38508 7.84188C4.20477 7.64955 4.20477 7.35027 4.38508 7.15794L8.13508 3.15794C8.32394 2.95648 8.64036 2.94628 8.84182 3.13514Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgGear() {
  return `<svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.07095 0.650238C6.67391 0.650238 6.32977 0.925096 6.24198 1.31231L6.0039 2.36247C5.6249 2.47269 5.26335 2.62696 4.92816 2.82081L3.99319 2.2393C3.66069 2.03114 3.23126 2.07475 2.94395 2.36206L2.36206 2.94395C2.07475 3.23126 2.03114 3.66069 2.2393 3.99319L2.82081 4.92816C2.62696 5.26335 2.47269 5.6249 2.36247 6.0039L1.31231 6.24198C0.925096 6.32977 0.650238 6.67391 0.650238 7.07095V7.92905C0.650238 8.32609 0.925096 8.67023 1.31231 8.75802L2.36247 8.9961C2.47269 9.3751 2.62696 9.73665 2.82081 10.0718L2.2393 11.0068C2.03114 11.3393 2.07475 11.7687 2.36206 12.056L2.94395 12.6379C3.23126 12.9253 3.66069 12.9689 3.99319 12.7607L4.92816 12.1792C5.26335 12.373 5.6249 12.5273 6.0039 12.6375L6.24198 13.6877C6.32977 14.0749 6.67391 14.3498 7.07095 14.3498H7.92905C8.32609 14.3498 8.67023 14.0749 8.75802 13.6877L8.9961 12.6375C9.3751 12.5273 9.73665 12.373 10.0718 12.1792L11.0068 12.7607C11.3393 12.9689 11.7687 12.9253 12.056 12.6379L12.6379 12.056C12.9253 11.7687 12.9689 11.3393 12.7607 11.0068L12.1792 10.0718C12.373 9.73665 12.5273 9.3751 12.6375 8.9961L13.6877 8.75802C14.0749 8.67023 14.3498 8.32609 14.3498 7.92905V7.07095C14.3498 6.67391 14.0749 6.32977 13.6877 6.24198L12.6375 6.0039C12.5273 5.6249 12.373 5.26335 12.1792 4.92816L12.7607 3.99319C12.9689 3.66069 12.9253 3.23126 12.6379 2.94395L12.056 2.36206C11.7687 2.07475 11.3393 2.03114 11.0068 2.2393L10.0718 2.82081C9.73665 2.62696 9.3751 2.47269 8.9961 2.36247L8.75802 1.31231C8.67023 0.925096 8.32609 0.650238 7.92905 0.650238H7.07095ZM4.95 7.5C4.95 6.0812 6.0812 4.95 7.5 4.95C8.9188 4.95 10.05 6.0812 10.05 7.5C10.05 8.9188 8.9188 10.05 7.5 10.05C6.0812 10.05 4.95 8.9188 4.95 7.5Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgTrash() {
  return `<svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M5.5 1C5.22386 1 5 1.22386 5 1.5C5 1.77614 5.22386 2 5.5 2H9.5C9.77614 2 10 1.77614 10 1.5C10 1.22386 9.77614 1 9.5 1H5.5ZM3 3.5C3 3.22386 3.22386 3 3.5 3H11.5C11.7761 3 12 3.22386 12 3.5C12 3.77614 11.7761 4 11.5 4H11V12C11 12.5523 10.5523 13 10 13H5C4.44772 13 4 12.5523 4 12V4H3.5C3.22386 4 3 3.77614 3 3.5ZM5 4H10V12H5V4Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgClose() {
  return `<svg width="14" height="14" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

function svgSend() {
  return `<svg width="13" height="13" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.20308 1.04312C1.00481 0.954998 0.772341 1.0048 0.627577 1.16641C0.482813 1.32802 0.458794 1.56455 0.568117 1.75196L3.92115 7.50002L0.568117 13.2481C0.458794 13.4355 0.482813 13.672 0.627577 13.8336C0.772341 13.9952 1.00481 14.045 1.20308 13.9569L14.7031 7.95693C14.8836 7.87668 15 7.69762 15 7.50002C15 7.30243 14.8836 7.12337 14.7031 7.04312L1.20308 1.04312Z" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg>`;
}

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