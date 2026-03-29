// popup.js — PasteToWrite v3.0

const $ = id => document.getElementById(id);

const DEFAULTS = { wpm: 80, errors: 5, bursts: 30 };

// ── Apply settings to UI ──────────────────────────────────────────────────────
function applySettings(wpm, errors, bursts) {
  $("wpm").value    = wpm;    $("wpmVal").textContent    = wpm    + " wpm";
  $("errors").value = errors; $("errorsVal").textContent = errors + "%";
  $("bursts").value = bursts; $("burstsVal").textContent = bursts + "%";
}

// ── Save current settings to storage ─────────────────────────────────────────
function saveSettings() {
  chrome.storage.local.set({
    wpm:      $("wpm").value,
    errors:   $("errors").value,
    bursts:   $("bursts").value,
    lastText: $("text").value
  });
}

// ── Push live setting changes to background while typing ──────────────────────
function pushSettingsIfTyping() {
  chrome.runtime.sendMessage({
    action:     "updateSettings",
    wpm:        Number($("wpm").value),
    errorRate:  Number($("errors").value) / 100,
    burstiness: Number($("bursts").value) / 100
  }).catch(() => {});
}

// ── Restore from storage on open ─────────────────────────────────────────────
chrome.storage.local.get(["wpm","errors","bursts","lastText"], d => {
  applySettings(
    d.wpm     !== undefined ? Number(d.wpm)     : DEFAULTS.wpm,
    d.errors  !== undefined ? Number(d.errors)  : DEFAULTS.errors,
    d.bursts  !== undefined ? Number(d.bursts)  : DEFAULTS.bursts
  );
  if (d.lastText) $("text").value = d.lastText;
});

// ── Slider listeners — save + push live ──────────────────────────────────────
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
$("text").addEventListener("input", () => saveSettings());

// ── Clear text button ─────────────────────────────────────────────────────────
$("btnClearText").addEventListener("click", () => {
  $("text").value = "";
  saveSettings();
  $("text").focus();
});

// ── Reset to defaults ─────────────────────────────────────────────────────────
$("btnReset").addEventListener("click", () => {
  applySettings(DEFAULTS.wpm, DEFAULTS.errors, DEFAULTS.bursts);
  saveSettings();
  pushSettingsIfTyping();
});

// ── UI state ──────────────────────────────────────────────────────────────────
function setStatus(msg, cls) {
  const el = $("status");
  el.className = "statusbar " + (cls || "");
  const icons = { err:"⚠️", good:"✅", warn:"⏸", run:"⌨️" };
  el.innerHTML = `<span class="icon">${icons[cls]||"💡"}</span><span>${msg}</span>`;
}

function setIdle() {
  $("dot").className = "dot";
  $("btnStart").disabled = false;
  $("btnPause").disabled = true;
  $("btnPause").textContent = "⏸ Pause";
  $("btnPause").classList.remove("resuming");
  $("btnStop").disabled = true;
  isPaused = false;
}
function setRunning() {
  $("dot").className = "dot running";
  $("btnStart").disabled = true;
  $("btnPause").disabled = false;
  $("btnPause").textContent = "⏸ Pause";
  $("btnPause").classList.remove("resuming");
  $("btnStop").disabled = false;
  isPaused = false;
}
function setPaused() {
  $("dot").className = "dot paused";
  $("btnStart").disabled = true;
  $("btnPause").disabled = false;
  $("btnPause").textContent = "▶ Resume";
  $("btnPause").classList.add("resuming");
  $("btnStop").disabled = false;
  isPaused = true;
}

let isPaused = false;

// ── Background messages ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === "typingDone") {
    setIdle();
    if      (msg.reason === "stopped")       setStatus("Stopped.");
    else if (msg.reason === "attach_failed") setStatus("Couldn't attach: " + (msg.msg||""), "err");
    else                                     setStatus("Done! All text typed ✓", "good");
  }
  if (msg.action === "typingPaused")  { setPaused();  setStatus("Paused — hit Resume to continue.", "warn"); }
  if (msg.action === "typingResumed") { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
});

// ── Start ─────────────────────────────────────────────────────────────────────
$("btnStart").addEventListener("click", async () => {
  const text = $("text").value;
  if (!text.trim()) { setStatus("Paste some text first.", "err"); return; }

  const tabs = await chrome.tabs.query({ active:true, currentWindow:true });
  const tab  = tabs[0];
  if (!tab) { setStatus("No active tab found.", "err"); return; }
  if (!tab.url || /^(chrome|chrome-extension|about):/.test(tab.url)) {
    setStatus("Can't type on Chrome system pages.", "err"); return;
  }

  let res;
  try {
    res = await chrome.runtime.sendMessage({
      action:     "startTyping",
      tabId:      tab.id,
      text,
      wpm:        Number($("wpm").value),
      errorRate:  Number($("errors").value) / 100,
      burstiness: Number($("bursts").value) / 100
    });
  } catch(e) { setStatus("Error: " + e.message, "err"); return; }

  if (res?.ok)                           { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
  else if (res?.reason === "already_typing") setStatus("Already typing — stop first.", "err");
  else                                       setStatus("Something went wrong.", "err");
});

// ── Pause / Resume ────────────────────────────────────────────────────────────
$("btnPause").addEventListener("click", async () => {
  if (!isPaused) {
    await chrome.runtime.sendMessage({ action:"pauseTyping" });
  } else {
    await chrome.runtime.sendMessage({ action:"resumeTyping" });
  }
});

// ── Stop ──────────────────────────────────────────────────────────────────────
$("btnStop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action:"stopTyping" });
  setIdle(); setStatus("Stopped.");
});
