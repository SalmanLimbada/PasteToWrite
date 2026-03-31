let typingState = null;

function rand(a, b) { return a + Math.random() * (b - a); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function interruptibleSleep(ms) {
  const chunk = 30;
  let elapsed = 0;
  while (elapsed < ms) {
    if (!typingState || typingState.stopRequested) return;
    if (typingState.pauseRequested) await waitForResume();
    await sleep(Math.min(chunk, ms - elapsed));
    elapsed += chunk;
  }
}

function waitForResume() {
  return new Promise(resolve => {
    if (typingState) typingState.resumeResolve = resolve;
  });
}

function attach(tabId) {
  return new Promise((res, rej) =>
    chrome.debugger.attach({ tabId }, "1.3", () =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
}

function detach(tabId) {
  return new Promise(res => chrome.debugger.detach({ tabId }, () => res()));
}

function send(tabId, method, params) {
  return new Promise((res, rej) =>
    chrome.debugger.sendCommand({ tabId }, method, params || {}, r =>
      chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(r)));
}

async function cdpInsertText(tabId, ch) {
  await send(tabId, "Input.insertText", { text: ch });
}

async function cdpEnter(tabId) {
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Return", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Return", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
}

async function cdpBackspace(tabId) {
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
}

const NEARBY = {
  a: "sqwz", b: "vghn", c: "xdfv", d: "esxcrf", e: "wsdr", f: "rdcvtg", g: "tyfvbh",
  h: "gyujbn", i: "ujko", j: "huknmi", k: "jilom", l: "kop", m: "njk", n: "bhjm",
  o: "iklp", p: "ol", q: "wa", r: "edft", s: "awedxz", t: "rfgy", u: "yhji",
  v: "cfgb", w: "qase", x: "zsdc", y: "tugh", z: "asx"
};

function maybeTypo(ch, rate) {
  if (rate <= 0 || Math.random() > rate) return null;
  const n = NEARBY[ch.toLowerCase()];
  if (!n) return null;
  return n[Math.floor(Math.random() * n.length)];
}

// Extra pause multiplier per character — makes punctuation feel natural
function punctuationMultiplier(ch) {
  if (ch === '.' || ch === '!' || ch === '?' || ch === ':' || ch === ';') return rand(2.5, 4.0);
  if (ch === ',') return rand(1.4, 2.2);
  if (ch === ' ') return rand(1.1, 1.5);
  return 1;
}

async function startTyping(tabId, text, wpm, errorRate, burstiness) {
  typingState = { tabId, stopRequested: false, pauseRequested: false, resumeResolve: null, wpm, errorRate, burstiness };

  try { await attach(tabId); }
  catch (e) {
    try { await detach(tabId); } catch (_) {}
    try { await attach(tabId); }
    catch (e2) {
      notifyPopup({ action: "typingDone", reason: "attach_failed", msg: String(e2) });
      typingState = null;
      return;
    }
  }

  // Delete selected text before typing — if nothing selected this is a no-op
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp",   key: "Delete", code: "Delete", windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 });

  try {
    for (let i = 0; i < text.length; i++) {
      if (!typingState || typingState.stopRequested) break;
      if (typingState.pauseRequested) {
        await waitForResume();
        if (!typingState || typingState.stopRequested) break;
      }

      const wpmNow       = typingState.wpm;
      const errorRateNow = typingState.errorRate;
      const burstinessNow = typingState.burstiness;
      const baseDelay    = 60000 / (wpmNow * 6);
      const ch           = text[i];

      // Progress
      notifyPopup({ action: "typingProgress", index: i, total: text.length });

      if (ch === "\n" || ch === "\r") {
        await cdpEnter(tabId);
        await interruptibleSleep(baseDelay * rand(1.5, 3.0));
        continue;
      }

      const typo = maybeTypo(ch, errorRateNow);
      if (typo) {
        await cdpInsertText(tabId, typo);
        await interruptibleSleep(baseDelay * rand(2, 5));
        if (!typingState || typingState.stopRequested) break;
        await cdpBackspace(tabId);
        await interruptibleSleep(baseDelay * rand(0.8, 1.8));
        if (!typingState || typingState.stopRequested) break;
      }

      await cdpInsertText(tabId, ch);

      let delay = baseDelay * rand(0.6, 1.8) * punctuationMultiplier(ch);
      if (burstinessNow > 0 && Math.random() < burstinessNow * 0.12) delay += rand(250, 1400);
      await interruptibleSleep(delay);
    }
  } catch (err) {
    console.error("PasteToWrite error:", err);
  }

  notifyPopup({ action: "typingProgress", index: text.length, total: text.length });
  const reason = typingState && typingState.stopRequested ? "stopped" : "finished";
  try { await detach(tabId); } catch (_) {}
  typingState = null;
  notifyPopup({ action: "typingDone", reason });
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "startTyping") {
    if (typingState) { sendResponse({ ok: false, reason: "already_typing" }); return true; }
    startTyping(msg.tabId, msg.text, msg.wpm, msg.errorRate, msg.burstiness);
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "updateSettings") {
    if (typingState) {
      typingState.wpm = msg.wpm;
      typingState.errorRate = msg.errorRate;
      typingState.burstiness = msg.burstiness;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "pauseTyping") {
    if (typingState && !typingState.pauseRequested) {
      typingState.pauseRequested = true;
      notifyPopup({ action: "typingPaused" });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "resumeTyping") {
    if (typingState && typingState.pauseRequested) {
      typingState.pauseRequested = false;
      if (typingState.resumeResolve) {
        typingState.resumeResolve();
        typingState.resumeResolve = null;
      }
      notifyPopup({ action: "typingResumed" });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "stopTyping") {
    if (typingState) {
      typingState.stopRequested = true;
      if (typingState.resumeResolve) {
        typingState.resumeResolve();
        typingState.resumeResolve = null;
      }
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "ping") {
    sendResponse({ ok: true, isTyping: !!typingState, isPaused: !!(typingState && typingState.pauseRequested) });
    return true;
  }
});