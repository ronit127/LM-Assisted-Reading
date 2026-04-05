const apiKeyInput = document.getElementById("api-key-input");
const saveKeyBtn = document.getElementById("save-key-btn");
const keyStatus = document.getElementById("key-status");
const togglePanelBtn = document.getElementById("toggle-panel-btn");

// Load saved key (show masked placeholder if present)
chrome.storage.local.get("apiKey", ({ apiKey }) => {
  if (apiKey) {
    apiKeyInput.placeholder = "sk-ant-…(saved)";
  }
});

saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Please enter a key.";
    keyStatus.className = "status-msg error";
    return;
  }
  chrome.storage.local.set({ apiKey: key }, () => {
    apiKeyInput.value = "";
    apiKeyInput.placeholder = "sk-ant-…(saved)";
    keyStatus.textContent = "Key saved.";
    keyStatus.className = "status-msg";
    setTimeout(() => (keyStatus.textContent = ""), 2000);
  });
});

togglePanelBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "TOGGLE_PANEL" });
  window.close();
});
