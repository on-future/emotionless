// 서비스 워커: 모델을 실행하는 오프스크린 문서를 띄우고 분류 요청을 전달한다.

let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "댓글 감정 분류 모델을 기기 안에서 실행합니다.",
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 댓글 위치 지정이 한 프레임에서 끝나면, 같은 탭의 다른 프레임에도 알려 함께 끝낸다.
  if (msg?.type === "pick-done" && sender.tab?.id != null) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "pick-stop", cancelled: msg.cancelled === true }).catch(() => {});
    return false;
  }
  if (msg?.type !== "classify" || msg.target === "offscreen") return false;
  (async () => {
    try {
      await ensureOffscreen();
      sendResponse(await chrome.runtime.sendMessage({ target: "offscreen", type: "classify", texts: msg.texts }));
    } catch (err) {
      sendResponse({ error: String(err?.message ?? err) });
    }
  })();
  return true;
});

// ── 피드백 서버 ──────────────────────────────────────────────────────────
// 사용자가 동의한 경우에만 고친 내용을 보내고, 검토를 거쳐 공개된 묶음을 받아 온다.
const API_BASE = __API_BASE__;
const GROUPS = ["anger", "blame", "complaint", "positive", "sad", "fear", "surprise", "neutral"];
const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function installId() {
  const { installId: saved } = await chrome.storage.local.get("installId");
  if (saved) return saved;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ installId: created });
  return created;
}

async function sendFeedback(payload) {
  if (!API_BASE) return;
  const { shareFeedback } = await chrome.storage.local.get("shareFeedback");
  if (shareFeedback !== true) return;
  await fetch(`${API_BASE}/v1/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, install: await installId(), version: chrome.runtime.getManifest().version }),
  });
}

// 서버에서 온 값도 그대로 믿지 않고 모양을 확인해 걸러 낸다.
function sanitizeShared(body) {
  const phrases = (list) =>
    (Array.isArray(list) ? list : []).filter((p) => typeof p === "string" && p.length > 0 && p.length <= 40).slice(0, 2000);
  const examples = (Array.isArray(body?.examples) ? body.examples : [])
    .filter(
      (e) =>
        GROUPS.includes(e?.g) &&
        Array.isArray(e.v) &&
        e.v.length === 44 &&
        e.v.every((n) => Number.isInteger(n) && n >= 0 && n <= 100),
    )
    .slice(0, 5000)
    .map((e) => ({ v: e.v, g: e.g }));
  return { version: Number.isInteger(body?.version) ? body.version : 0, examples, remove: phrases(body?.remove), keep: phrases(body?.keep) };
}

async function syncShared() {
  if (!API_BASE) return;
  const { sharedFetchedAt = 0 } = await chrome.storage.local.get("sharedFetchedAt");
  if (Date.now() - sharedFetchedAt < SYNC_INTERVAL_MS) return;
  // 실패해도 곧바로 다시 시도하지 않도록 시각을 먼저 적어 둔다.
  await chrome.storage.local.set({ sharedFetchedAt: Date.now() });
  // 받는 주기를 이미 직접 조절하고 있으므로 브라우저 캐시는 쓰지 않는다.
  const res = await fetch(`${API_BASE}/v1/shared.json`, { cache: "no-store" });
  if (!res.ok) return;
  await chrome.storage.local.set({ shared: sanitizeShared(await res.json()) });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "feedback") sendFeedback(msg.payload).catch(() => {});
  else if (msg?.type === "sync-shared") syncShared().catch(() => {});
  return false;
});
