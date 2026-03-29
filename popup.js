const $ = id => document.getElementById(id);
const DEFAULTS = { wpm: 80, errors: 5, bursts: 30 };

// How long the full text will take given current settings.
// Accounts for per-char delay variance (avg 1.2x base), typo overhead, and pause bursts.
function calcEstimateSecs(text, wpm, errorPct, burstPct) {
  if (!text || !text.trim()) return null;
  const chars = text.length;
  const baseDelayMs = 60000 / (wpm * 5);
  const avgDelayMs  = baseDelayMs * 1.2;                         // avg of rand(0.6, 1.8)
  const typoRate    = errorPct / 100;
  const typoExtra   = typoRate * (baseDelayMs * 3.5 + baseDelayMs * 3.5 + baseDelayMs * 1.3); // type wrong + pause + backspace + pause
  const burstExtra  = (burstPct / 100) * 0.12 * 825;            // avg added pause ~825ms, 12% of chars
  const msPerChar   = avgDelayMs + typoExtra + burstExtra;
  return Math.round((chars * msPerChar) / 1000);
}

function formatTime(secs) {
  if (secs === null) return "—";
  if (secs < 60)  return secs + "s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? m + "m" : m + "m " + s + "s";
}

function updateEstimate() {
  const text      = $("text").value;
  const wpm       = Number($("wpm").value);
  const errorPct  = Number($("errors").value);
  const burstPct  = Number($("bursts").value);
  const el        = $("estimateVal");
  const secs      = calcEstimateSecs(text, wpm, errorPct, burstPct);
  el.textContent  = formatTime(secs);
  el.className    = "estimate-value" + (countdown !== null ? " counting" : "");
}

// Countdown while typing
let countdown     = null;   // remaining seconds
let countdownTimer = null;  // setInterval id
let countdownWpm  = 80;
let countdownErr  = 5;
let countdownBurst = 30;

function startCountdown(text, wpm, errorPct, burstPct) {
  stopCountdown();
  countdownWpm   = wpm;
  countdownErr   = errorPct;
  countdownBurst = burstPct;
  countdown = calcEstimateSecs(text, wpm, errorPct, burstPct);
  renderCountdown();
  countdownTimer = setInterval(() => {
    if (!isPaused && countdown !== null && countdown > 0) {
      countdown--;
      renderCountdown();
    }
  }, 1000);
}

function renderCountdown() {
  const el = $("estimateVal");
  el.textContent = countdown !== null ? formatTime(countdown) : "—";
  el.className = "estimate-value" + (countdown !== null ? " counting" : "");
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdown = null;
}

function recalcCountdown() {
  if (countdown === null) return;
  // Recompute remaining time based on new settings keeping current countdown proportion
  const text      = $("text").value;
  const wpm       = Number($("wpm").value);
  const errorPct  = Number($("errors").value);
  const burstPct  = Number($("bursts").value);
  const total     = calcEstimateSecs(text, wpm, errorPct, burstPct);
  const oldTotal  = calcEstimateSecs(text, countdownWpm, countdownErr, countdownBurst);
  if (oldTotal && total) {
    const ratio  = countdown / oldTotal;
    countdown    = Math.round(total * ratio);
  }
  countdownWpm   = wpm;
  countdownErr   = errorPct;
  countdownBurst = burstPct;
  renderCountdown();
}

function applySettings(wpm, errors, bursts) {
  $("wpm").value    = wpm;    $("wpmVal").textContent    = wpm    + " wpm";
  $("errors").value = errors; $("errorsVal").textContent = errors + "%";
  $("bursts").value = bursts; $("burstsVal").textContent = bursts + "%";
}

function saveSettings() {
  chrome.storage.local.set({
    wpm:      $("wpm").value,
    errors:   $("errors").value,
    bursts:   $("bursts").value,
    lastText: $("text").value
  });
}

function pushSettingsIfTyping() {
  chrome.runtime.sendMessage({
    action:     "updateSettings",
    wpm:        Number($("wpm").value),
    errorRate:  Number($("errors").value) / 100,
    burstiness: Number($("bursts").value) / 100
  }).catch(() => {});
}

// Restore settings on open
chrome.storage.local.get(["wpm", "errors", "bursts", "lastText"], d => {
  applySettings(
    d.wpm    !== undefined ? Number(d.wpm)    : DEFAULTS.wpm,
    d.errors !== undefined ? Number(d.errors) : DEFAULTS.errors,
    d.bursts !== undefined ? Number(d.bursts) : DEFAULTS.bursts
  );
  if (d.lastText) $("text").value = d.lastText;
  updateEstimate();
});

// Sync UI state with background on every popup open
chrome.runtime.sendMessage({ action: "ping" }, res => {
  if (chrome.runtime.lastError || !res) return;
  if (res.isTyping && res.isPaused) { setPaused();  setStatus("Paused — hit Resume to continue.", "warn"); }
  else if (res.isTyping)            { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
  else                              { setIdle(); }
});

$("wpm").addEventListener("input", () => {
  $("wpmVal").textContent = $("wpm").value + " wpm";
  saveSettings(); pushSettingsIfTyping(); updateEstimate(); recalcCountdown();
});
$("errors").addEventListener("input", () => {
  $("errorsVal").textContent = $("errors").value + "%";
  saveSettings(); pushSettingsIfTyping(); updateEstimate(); recalcCountdown();
});
$("bursts").addEventListener("input", () => {
  $("burstsVal").textContent = $("bursts").value + "%";
  saveSettings(); pushSettingsIfTyping(); updateEstimate(); recalcCountdown();
});
$("text").addEventListener("input", () => { saveSettings(); updateEstimate(); });

$("btnClearText").addEventListener("click", () => {
  $("text").value = "";
  saveSettings();
  updateEstimate();
  $("text").focus();
});

$("btnReset").addEventListener("click", () => {
  applySettings(DEFAULTS.wpm, DEFAULTS.errors, DEFAULTS.bursts);
  saveSettings(); pushSettingsIfTyping(); updateEstimate(); recalcCountdown();
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
    stopCountdown();
    updateEstimate();
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
      action:     "startTyping",
      tabId:      tab.id,
      text,
      wpm:        Number($("wpm").value),
      errorRate:  Number($("errors").value) / 100,
      burstiness: Number($("bursts").value) / 100
    });
  } catch (e) { setStatus("Error: " + e.message, "err"); return; }

  if (res?.ok) {
    setRunning();
    setStatus("Typing… click back on your tab!", "run");
    startCountdown(text, Number($("wpm").value), Number($("errors").value), Number($("bursts").value));
  } else if (res?.reason === "already_typing") {
    setStatus("Already typing — stop first.", "err");
  } else {
    setStatus("Something went wrong.", "err");
  }
});

$("btnPause").addEventListener("click", async () => {
  if (!isPaused) await chrome.runtime.sendMessage({ action: "pauseTyping" });
  else           await chrome.runtime.sendMessage({ action: "resumeTyping" });
});

$("btnStop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ action: "stopTyping" });
  stopCountdown();
  updateEstimate();
  setIdle();
  setStatus("Stopped.");
});