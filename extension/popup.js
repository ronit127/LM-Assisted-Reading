const placeholder = document.getElementById("placeholder");
const selectionText = document.getElementById("selection-text");

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "SELECTION_CHANGED") return;
  if (msg.text) {
    placeholder.hidden = true;
    selectionText.hidden = false;
    selectionText.textContent = msg.text;
  } else {
    placeholder.hidden = false;
    selectionText.hidden = true;
  }
});
