chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  chrome.scripting.executeScript(
    { target: { tabId: tab.id }, func: () => document.body.innerText.trim() },
    ([result]) => {
      document.getElementById("text").textContent = result?.result || "No text found.";
    }
  );
});
