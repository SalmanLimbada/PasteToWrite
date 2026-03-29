const $ = id => document.getElementById(id);
const DEFAULTS = { wpm: 80, errors: 5, bursts: 30 };

function applySettings(wpm, errors, bursts) {
  $("wpm").value    = wpm;    $("wpmVal").textContent    = wpm    + " wpm";
  $("errors").value = errors; $("errorsVal").textContent = errors + "%";
  $("bursts").value = bursts; $("burstsVal").textContent = bursts + "%";
}

function saveSettings() {
  chrome.storage.local.set({
    wpm: $("wpm").value,
    errors: $("errors").value,
    bursts: $("bursts").value,
    lastText: $("text").value
  });
}

function pushSettingsIfTyping() {
  chrome.runtime.sendMessage({
    action: "updateSettings",
    wpm:        Number($("wpm").value),
    errorRate:  Number($("errors").value) / 100,
    burstiness: Number($("bursts").value) / 100
  }).catch(() => {});
}

chrome.storage.local.get(["wpm", "errors", "bursts", "lastText"], d => {
  applySettings(
    d.wpm    !== undefined ? Number(d.wpm)    : DEFAULTS.wpm,
    d.errors !== undefined ? Number(d.errors) : DEFAULTS.errors,
    d.bursts !== undefined ? Number(d.bursts) : DEFAULTS.bursts
  );
  if (d.lastText) $("text").value = d.lastText;
});

chrome.runtime.sendMessage({ action: "ping" }, res => {
  if (chrome.runtime.lastError || !res) return;
  if (res.isTyping && res.isPaused) { setPaused();  setStatus("Paused — hit Resume to continue.", "warn"); }
  else if (res.isTyping)            { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
  else                              { setIdle(); }
});

$("wpm").addEventListener("input", () => {
  $("wpmVal").textContent = $("wpm").value + " wpm";
  saveSettings(); pushSettingsIfTyping();
});
$("errors").addEventListener("input", () => {
  $("errorsVal").textContent = $("errors").value + "%";
  saveSettings(); pushSettingsIfTyping();
});
$("bursts").addEventListener("input", () => {
  $("burstsVal").textContent = $("bursts").value + "%";
  saveSettings(); pushSettingsIfTyping();
});
$("text").addEventListener("input", saveSettings);

$("btnClearText").addEventListener("click", () => {
  $("text").value = "";
  saveSettings();
  $("text").focus();
});

$("btnReset").addEventListener("click", () => {
  applySettings(DEFAULTS.wpm, DEFAULTS.errors, DEFAULTS.bursts);
  saveSettings();
  pushSettingsIfTyping();
});

function setStatus(msg, cls) {
  const el = $("status");
  el.className = "statusbar " + (cls || "");
  const icons = { err: "⚠️", good: "✅", warn: "⏸", run: "⌨️" };
  el.innerHTML = `<span class="icon">${icons[cls] || "💡"}</span><span>${msg}</span>`;
}

let isPaused = false;

function setIdle() {
  isPaused = false;
  $("dot").className = "dot";
  $("btnStart").disabled = false;
  $("btnPause").disabled = true;
  $("btnPause").textContent = "⏸ Pause";
  $("btnPause").classList.remove("resuming");
  $("btnStop").disabled = true;
}

function setRunning() {
  isPaused = false;
  $("dot").className = "dot running";
  $("btnStart").disabled = true;
  $("btnPause").disabled = false;
  $("btnPause").textContent = "⏸ Pause";
  $("btnPause").classList.remove("resuming");
  $("btnStop").disabled = false;
}

function setPaused() {
  isPaused = true;
  $("dot").className = "dot paused";
  $("btnStart").disabled = true;
  $("btnPause").disabled = false;
  $("btnPause").textContent = "▶ Resume";
  $("btnPause").classList.add("resuming");
  $("btnStop").disabled = false;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === "typingDone") {
    setIdle();
    if      (msg.reason === "stopped")       setStatus("Stopped.");
    else if (msg.reason === "attach_failed") setStatus("Couldn't attach: " + (msg.msg || ""), "err");
    else                                     setStatus("Done! All text typed.", "good");
  }
  if (msg.action === "typingPaused")  { setPaused();  setStatus("Paused — hit Resume to continue.", "warn"); }
  if (msg.action === "typingResumed") { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
});

$("btnStart").addEventListener("click", async () => {
  const text = $("text").value;
  if (!text.trim()) { setStatus("Paste some text first.", "err"); return; }

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab  = tabs[0];
  if (!tab) { setStatus("No active tab found.", "err"); return; }
  if (!tab.url || /^(chrome|chrome-extension|about):/.test(tab.url)) {
    setStatus("Can't type on Chrome system pages.", "err"); return;
  }

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      action: "startTyping",
      tabId:  tab.id,
      text,
      wpm:        Number($("wpm").value),
      errorRate:  Number($("errors").value) / 100,
      burstiness: Number($("bursts").value) / 100
    });
  } catch (e) { setStatus("Error: " + e.message, "err"); return; }

  if (res?.ok)                               { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
  else if (res?.reason === "already_typing") { setStatus("Already typing — stop first.", "err"); }
  else                                       { setStatus("Something went wrong.", "err"); }
});

$("btnPause").addEventListener("click", async () => {
  if (!isPaused) await chrome.runtime.sendMessage({ action: "pauseTyping" });
  else           await chrome.runtime.sendMessage({ action: "resumeTyping" });
});

$("btnStop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "stopTyping" });
  setIdle();
  setStatus("Stopped.");
});