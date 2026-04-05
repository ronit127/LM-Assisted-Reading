// Content script — runs on every page.
// Responsibilities:
//   1. Tag block-level text elements with unique data-lm-uid attributes
//   2. Track the user's text selection and its anchor UID
//   3. Inject the interaction panel via Shadow DOM
//   4. Send queries to the background service worker
//   5. Render annotation responses inline in the DOM

(function () {
  "use strict";

  // ── 1. Guard against double-injection ──────────────────────────────────────
  if (window.__lmAssistInit) return;
  window.__lmAssistInit = true;

  // ── 2. Constants ───────────────────────────────────────────────────────────
  const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, td";
  // Elements whose descendants we skip (navigation chrome, not article body)
  const SKIP_ANCESTORS = new Set(["nav", "footer", "header", "aside", "menu"]);
  const ANNOTATION_CLASS = "lm-annotation";
  const CONTEXT_WINDOW = 2; // number of surrounding blocks to send as context

  // ── 3. UID tagging ─────────────────────────────────────────────────────────
  let uidCounter = 0;

  function isInsideSkippedAncestor(el) {
    let node = el.parentElement;
    while (node) {
      if (SKIP_ANCESTORS.has(node.tagName.toLowerCase())) return true;
      node = node.parentElement;
    }
    return false;
  }

  function tagBlockElements() {
    const blocks = document.querySelectorAll(BLOCK_SELECTOR);
    blocks.forEach((el) => {
      if (el.dataset.lmUid) return; // already tagged
      if (isInsideSkippedAncestor(el)) return;
      if (!el.textContent.trim()) return; // skip empty nodes
      el.dataset.lmUid = `lm-${uidCounter++}`;
    });
  }

  // Re-tag after dynamic content changes (SPAs, lazy-loaded articles)
  const domObserver = new MutationObserver(() => tagBlockElements());
  domObserver.observe(document.body, { childList: true, subtree: true });

  tagBlockElements();

  // ── 4. Ordered list of tagged blocks (for context window lookup) ───────────
  function getOrderedBlocks() {
    return Array.from(document.querySelectorAll(`[data-lm-uid]`)).filter(
      (el) => el.textContent.trim()
    );
  }

  function getContextBlocks(anchorUid) {
    const blocks = getOrderedBlocks();
    const idx = blocks.findIndex((b) => b.dataset.lmUid === anchorUid);
    if (idx === -1) return blocks.slice(0, CONTEXT_WINDOW * 2 + 1);

    const start = Math.max(0, idx - CONTEXT_WINDOW);
    const end = Math.min(blocks.length - 1, idx + CONTEXT_WINDOW);
    return blocks.slice(start, end + 1).map((b) => ({
      uid: b.dataset.lmUid,
      text: b.textContent.trim(),
    }));
  }

  // ── 5. Selection tracking ──────────────────────────────────────────────────
  let currentSelection = { text: "", anchorUid: null };

  function nearestTaggedAncestor(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el) {
      if (el.dataset?.lmUid) return el;
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener("selectionchange", () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      currentSelection = { text: "", anchorUid: null };
      updatePanelSelection("");
      return;
    }

    const text = sel.toString().trim();
    if (!text) return;

    const anchorNode = sel.anchorNode;
    const tagged = nearestTaggedAncestor(anchorNode);
    currentSelection = {
      text,
      anchorUid: tagged?.dataset.lmUid ?? null,
    };
    updatePanelSelection(text);
  });

  // ── 6. Shadow DOM panel ────────────────────────────────────────────────────
  let panelRoot = null;   // the Shadow root
  let panelVisible = true;

  const PANEL_HTML = `
<div id="lm-panel">
  <div id="lm-panel-header">
    <span id="lm-panel-title">LM Reading Assistant</span>
    <button id="lm-panel-close" title="Hide panel">✕</button>
  </div>
  <div id="lm-selection-preview" class="lm-hidden">
    <span id="lm-selection-label">Selected:</span>
    <span id="lm-selection-text"></span>
  </div>
  <div id="lm-input-row">
    <input id="lm-query-input" type="text" placeholder="Ask about the page or selection…" />
    <button id="lm-ask-btn">Ask</button>
  </div>
  <div id="lm-status"></div>
  <div id="lm-response-area"></div>
</div>
`;

  function injectPanel() {
    const host = document.createElement("div");
    host.id = "lm-panel-host";
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });

    // Load CSS into shadow root
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("panel.css");
    shadow.appendChild(link);

    const wrapper = document.createElement("div");
    wrapper.innerHTML = PANEL_HTML;
    shadow.appendChild(wrapper);
    panelRoot = shadow;

    // Wire up buttons
    shadow.getElementById("lm-panel-close").addEventListener("click", hidePanel);
    shadow.getElementById("lm-ask-btn").addEventListener("click", submitQuery);
    shadow.getElementById("lm-query-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitQuery();
    });
  }

  function hidePanel() {
    panelVisible = false;
    panelRoot?.getElementById("lm-panel")?.classList.add("lm-hidden");
  }

  function showPanel() {
    panelVisible = true;
    panelRoot?.getElementById("lm-panel")?.classList.remove("lm-hidden");
  }

  function updatePanelSelection(text) {
    if (!panelRoot) return;
    const preview = panelRoot.getElementById("lm-selection-preview");
    const selText = panelRoot.getElementById("lm-selection-text");
    if (text) {
      const truncated = text.length > 120 ? text.slice(0, 120) + "…" : text;
      selText.textContent = truncated;
      preview.classList.remove("lm-hidden");
    } else {
      preview.classList.add("lm-hidden");
    }
  }

  function setStatus(msg, isError = false) {
    if (!panelRoot) return;
    const el = panelRoot.getElementById("lm-status");
    el.textContent = msg;
    el.className = isError ? "lm-error" : "lm-info";
  }

  // ── 7. Submit query ────────────────────────────────────────────────────────
  async function submitQuery() {
    if (!panelRoot) return;
    const input = panelRoot.getElementById("lm-query-input");
    const query = input.value.trim();
    if (!query) return;

    const { text: selectedText, anchorUid } = currentSelection;

    if (!selectedText) {
      setStatus("Select some text on the page first, then ask your question.", true);
      return;
    }

    setStatus("Thinking…");
    panelRoot.getElementById("lm-ask-btn").disabled = true;

    const contextBlocks = getContextBlocks(anchorUid);

    chrome.runtime.sendMessage(
      {
        type: "QUERY",
        query,
        selectedText,
        contextBlocks,
        anchorUid,
      },
      (response) => {
        panelRoot.getElementById("lm-ask-btn").disabled = false;

        if (chrome.runtime.lastError) {
          setStatus("Extension error: " + chrome.runtime.lastError.message, true);
          return;
        }
        if (response?.error) {
          setStatus(response.error, true);
          return;
        }

        setStatus("");
        input.value = "";
        renderAnnotation(response.annotationText, response.anchorUid, query);
        showAnnotationInPanel(response.annotationText, query);
      }
    );
  }

  // ── 8. Render inline annotation ────────────────────────────────────────────
  function renderAnnotation(text, anchorUid, query) {
    const targetEl = anchorUid
      ? document.querySelector(`[data-lm-uid="${anchorUid}"]`)
      : null;

    const annotation = document.createElement("div");
    annotation.className = ANNOTATION_CLASS;
    annotation.dataset.lmQuery = query;

    const label = document.createElement("span");
    label.className = "lm-annotation-label";
    label.textContent = "LM Note";

    const body = document.createElement("p");
    body.textContent = text;

    const dismiss = document.createElement("button");
    dismiss.className = "lm-annotation-dismiss";
    dismiss.title = "Remove annotation";
    dismiss.textContent = "✕";
    dismiss.addEventListener("click", () => annotation.remove());

    annotation.append(label, dismiss, body);

    if (targetEl) {
      targetEl.insertAdjacentElement("afterend", annotation);
    } else {
      // Fallback: prepend to body if no anchor found
      document.body.prepend(annotation);
    }
  }

  // ── 9. Also show latest response inside the panel ─────────────────────────
  function showAnnotationInPanel(text, query) {
    if (!panelRoot) return;
    const area = panelRoot.getElementById("lm-response-area");

    const entry = document.createElement("div");
    entry.className = "lm-response-entry";

    const q = document.createElement("div");
    q.className = "lm-response-query";
    q.textContent = `Q: ${query}`;

    const a = document.createElement("div");
    a.className = "lm-response-answer";
    a.textContent = text;

    entry.append(q, a);
    area.prepend(entry); // newest first
  }

  // ── 10. Listen for messages from popup / background ────────────────────────
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "TOGGLE_PANEL") {
      panelVisible ? hidePanel() : showPanel();
    }
  });

  // ── 11. Inject annotation styles into the host page head ──────────────────
  function injectAnnotationStyles() {
    const style = document.createElement("style");
    style.id = "lm-annotation-styles";
    style.textContent = `
      .lm-annotation {
        position: relative;
        margin: 8px 0 12px 0;
        padding: 10px 36px 10px 14px;
        background: #fefce8;
        border-left: 3px solid #ca8a04;
        border-radius: 0 6px 6px 0;
        font-size: 0.88em;
        line-height: 1.55;
        color: #1c1917;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      }
      .lm-annotation-label {
        display: inline-block;
        font-size: 0.75em;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #92400e;
        margin-bottom: 4px;
      }
      .lm-annotation p {
        margin: 4px 0 0 0;
        padding: 0;
      }
      .lm-annotation-dismiss {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        cursor: pointer;
        font-size: 12px;
        color: #a16207;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 3px;
        opacity: 0.6;
      }
      .lm-annotation-dismiss:hover {
        opacity: 1;
        background: rgba(0,0,0,0.06);
      }
    `;
    document.head.appendChild(style);
  }

  // ── 12. Boot ───────────────────────────────────────────────────────────────
  function boot() {
    injectAnnotationStyles();
    injectPanel();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
