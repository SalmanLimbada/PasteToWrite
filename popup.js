const $ = id => document.getElementById(id);
const DEFAULTS = { wpm: 80, errors: 5, bursts: 30 };

function sanitizeRichHtml(html) {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const blockedTags = new Set(["SCRIPT", "STYLE", "LINK", "META", "IFRAME", "OBJECT", "EMBED"]);

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const toRemove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (blockedTags.has(el.tagName)) {
      toRemove.push(el);
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const el of toRemove) el.remove();
  return doc.body.innerHTML;
}

function getEditorText() {
  return ($("text").innerText || "").replace(/\u00a0/g, " ");
}

function getEditorHtml() {
  return sanitizeRichHtml($("text").innerHTML || "");
}

function setEditorHtml(html) {
  const safe = sanitizeRichHtml(html || "");
  $("text").innerHTML = safe;
}

function buildStyledTypingPayload() {
  const html = getEditorHtml();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || "", "text/html");
  const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE"]);

  let text = "";
  const runs = [];

  function appendChunk(chunk, style) {
    if (!chunk) return;
    const normalized = chunk.replace(/\u00a0/g, " ");
    if (!normalized) return;
    const start = text.length;
    text += normalized;
    const end = text.length;
    if (!(style.bold || style.italic || style.underline)) return;

    const last = runs[runs.length - 1];
    if (last && last.end === start && last.bold === style.bold && last.italic === style.italic && last.underline === style.underline) {
      last.end = end;
      return;
    }
    runs.push({ start, end, bold: style.bold, italic: style.italic, underline: style.underline });
  }

  function endsWithNewline() {
    return text.length > 0 && text[text.length - 1] === "\n";
  }

  function styleFromElement(base, el) {
    const next = { ...base };
    const tag = el.tagName;
    if (tag === "B" || tag === "STRONG") next.bold = true;
    if (tag === "I" || tag === "EM") next.italic = true;
    if (tag === "U") next.underline = true;

    const styleAttr = (el.getAttribute("style") || "").toLowerCase();
    if (styleAttr) {
      const fw = /font-weight\s*:\s*([^;]+)/.exec(styleAttr)?.[1]?.trim();
      if (fw) {
        if (fw === "normal" || fw === "400") next.bold = false;
        if (fw === "bold") next.bold = true;
        const fwNum = Number(fw);
        if (!Number.isNaN(fwNum)) next.bold = fwNum >= 600;
      }

      const fs = /font-style\s*:\s*([^;]+)/.exec(styleAttr)?.[1]?.trim();
      if (fs) {
        if (fs === "normal") next.italic = false;
        if (fs === "italic" || fs === "oblique") next.italic = true;
      }

      const td = /text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(styleAttr)?.[1]?.trim();
      if (td) {
        if (td.includes("none")) next.underline = false;
        if (td.includes("underline")) next.underline = true;
      }
    }

    return next;
  }

  function walk(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendChunk(node.nodeValue || "", style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    const tag = el.tagName;
    if (tag === "BR") {
      appendChunk("\n", style);
      return;
    }

    const nextStyle = styleFromElement(style, el);
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock && text.length > 0 && !endsWithNewline()) appendChunk("\n", style);

    for (const child of Array.from(el.childNodes)) walk(child, nextStyle);

    if (isBlock && text.length > 0 && !endsWithNewline()) appendChunk("\n", style);
  }

  for (const child of Array.from(doc.body.childNodes)) {
    walk(child, { bold: false, italic: false, underline: false });
  }

  text = text.replace(/^\n+|\n+$/g, "");
  if (!text) return { text: "", styleRuns: [] };

  const boundedRuns = runs
    .map(r => ({
      start: Math.max(0, Math.min(r.start, text.length)),
      end: Math.max(0, Math.min(r.end, text.length)),
      bold: !!r.bold,
      italic: !!r.italic,
      underline: !!r.underline
    }))
    .filter(r => r.end > r.start);

  return { text, styleRuns: boundedRuns };
}

function calcEstimateSecs(text, wpm, errorPct, burstPct) {
  if (!text || !text.trim()) return null;
  const chars       = text.length;
  const baseDelayMs = 60000 / (wpm * 6);
  const avgDelayMs  = baseDelayMs * 1.2;
  const typoRate    = errorPct / 100;
  const typoExtra   = typoRate * (baseDelayMs * 3.5 + baseDelayMs * 3.5 + baseDelayMs * 1.3);
  const burstExtra  = (burstPct / 100) * 0.12 * 825;
  const msPerChar   = avgDelayMs + typoExtra + burstExtra;
  return Math.round((chars * msPerChar) / 1000);
}

function formatTime(secs) {
  if (secs === null) return "—";
  if (secs < 60) return secs + "s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? m + "m" : m + "m " + s + "s";
}

function updateEstimate() {
  const secs = calcEstimateSecs(getEditorText(), Number($("wpm").value), Number($("errors").value), Number($("bursts").value));
  $("estimateVal").textContent = formatTime(secs);
  $("estimateVal").className   = "estimate-value" + (countdown !== null ? " counting" : "");
}

let countdown      = null;
let countdownTimer = null;
let countdownWpm   = DEFAULTS.wpm;
let countdownErr   = DEFAULTS.errors;
let countdownBurst = DEFAULTS.bursts;

function startCountdown(text, wpm, errorPct, burstPct) {
  stopCountdown();
  countdownWpm   = wpm;
  countdownErr   = errorPct;
  countdownBurst = burstPct;
  countdown      = calcEstimateSecs(text, wpm, errorPct, burstPct);
  renderCountdown();
  countdownTimer = setInterval(() => {
    if (!isPaused && countdown !== null && countdown > 0) { countdown--; renderCountdown(); }
  }, 1000);
}

function renderCountdown() {
  $("estimateVal").textContent = countdown !== null ? formatTime(countdown) : "—";
  $("estimateVal").className   = "estimate-value" + (countdown !== null ? " counting" : "");
}

function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  countdown = null;
}

function recalcCountdown() {
  if (countdown === null) return;
  const text     = getEditorText();
  const wpm      = Number($("wpm").value);
  const errorPct = Number($("errors").value);
  const burstPct = Number($("bursts").value);
  const total    = calcEstimateSecs(text, wpm, errorPct, burstPct);
  const oldTotal = calcEstimateSecs(text, countdownWpm, countdownErr, countdownBurst);
  if (oldTotal && total) countdown = Math.round(total * (countdown / oldTotal));
  countdownWpm   = wpm;
  countdownErr   = errorPct;
  countdownBurst = burstPct;
  renderCountdown();
}

function setProgress(index, total) {
  const pct = total > 0 ? Math.min(100, Math.round((index / total) * 100)) : 0;
  $("progressBar").style.width = pct + "%";
  $("progressPct").textContent = total > 0 ? pct + "%" : "";
}

function resetProgress() {
  $("progressBar").style.width = "0%";
  $("progressPct").textContent = "";
}

function autoResizeTextarea() {
  const ta = $("text");
  ta.style.height = "auto";
  ta.style.height = Math.min(280, Math.max(78, ta.scrollHeight)) + "px";
}

function applySettings(wpm, errors, bursts) {
  $("wpm").value    = wpm;    $("wpmVal").textContent    = wpm    + " wpm";
  $("errors").value = errors; $("errorsVal").textContent = errors + "%";
  $("bursts").value = bursts; $("burstsVal").textContent = bursts + "%";
}

function saveSettings() {
  const editorText = getEditorText();
  const editorHtml = getEditorHtml();
  chrome.storage.local.set({
    wpm:          $("wpm").value,
    errors:       $("errors").value,
    bursts:       $("bursts").value,
    lastText:     editorText,
    lastRichText: editorHtml,
    lastTextTime: editorText.trim() ? Date.now() : null
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

chrome.storage.local.get(["wpm", "errors", "bursts", "lastText", "lastRichText", "lastTextTime"], d => {
  applySettings(
    d.wpm    !== undefined ? Number(d.wpm)    : DEFAULTS.wpm,
    d.errors !== undefined ? Number(d.errors) : DEFAULTS.errors,
    d.bursts !== undefined ? Number(d.bursts) : DEFAULTS.bursts
  );
  const oneHour = 60 * 60 * 1000;
  const fresh = d.lastTextTime && (Date.now() - d.lastTextTime) < oneHour;
  if ((d.lastRichText || d.lastText) && fresh) {
    if (d.lastRichText) setEditorHtml(d.lastRichText);
    else setEditorHtml((d.lastText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>"));
    autoResizeTextarea();
  } else if ((d.lastRichText || d.lastText) && !fresh) {
    chrome.storage.local.remove(["lastText", "lastRichText", "lastTextTime"]);
  }
  updateEstimate();
});

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
$("text").addEventListener("input", () => { saveSettings(); updateEstimate(); autoResizeTextarea(); });
$("text").addEventListener("paste", e => {
  const cd = e.clipboardData;
  if (cd) {
    const hasImageItem = Array.from(cd.items || []).some(item => item.kind === "file" && item.type.startsWith("image/"));
    const html = cd.getData("text/html") || "";
    const hasInlineImage = /<img\b/i.test(html);
    if (hasImageItem || hasInlineImage) {
      e.preventDefault();
      setStatus("Images are not supported here. Paste text only.", "err");
      return;
    }
  }

  setTimeout(() => {
    setEditorHtml(getEditorHtml());
    autoResizeTextarea();
    updateEstimate();
    saveSettings();
  }, 0);
});

$("btnClearText").addEventListener("click", () => {
  setEditorHtml("");
  saveSettings(); updateEstimate(); autoResizeTextarea();
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
    stopCountdown(); updateEstimate(); resetProgress(); setIdle();
    if      (msg.reason === "stopped")       setStatus("Stopped.");
    else if (msg.reason === "attach_failed") setStatus("Couldn't attach: " + (msg.msg || ""), "err");
    else if (msg.reason === "failed")        setStatus("Typing failed: " + (msg.msg || "unexpected error"), "err");
    else                                     setStatus("Done! All text typed.", "good");
  }
  if (msg.action === "typingPaused")   { setPaused();  setStatus("Paused — hit Resume to continue.", "warn"); }
  if (msg.action === "typingResumed")  { setRunning(); setStatus("Typing… click back on your tab!", "run"); }
  if (msg.action === "typingProgress") { setProgress(msg.index, msg.total); }
});

$("btnStart").addEventListener("click", async () => {
  const payload = buildStyledTypingPayload();
  const text = payload.text;
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
      styleRuns:   payload.styleRuns,
      wpm:        Number($("wpm").value),
      errorRate:  Number($("errors").value) / 100,
      burstiness: Number($("bursts").value) / 100
    });
  } catch (e) { setStatus("Error: " + e.message, "err"); return; }

  if (res?.ok) {
    setRunning();
    setStatus("Typing… click back on your tab!", "run");
    startCountdown(text, Number($("wpm").value), Number($("errors").value), Number($("bursts").value));
    resetProgress();
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
  stopCountdown(); updateEstimate(); resetProgress(); setIdle(); setStatus("Stopped.");
});