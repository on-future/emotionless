// 서비스 워커: 모델을 실행하는 오프스크린 문서를 띄우고 분류 요청을 전달한다.
import { MODEL_MAX_BYTES, compatibleMeta, loadStoredModel, sha256Hex, storeModel, verifyModelSignature } from "./shared/model-store.js";

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
  // 페이지가 열리자마자 모델을 미리 불러 둔다. 첫 댓글을 기다리지 않게 하려는 것이다.
  if (msg?.type === "warm") {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: "offscreen", type: "warm" }))
      .catch(() => {});
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
// 사용자가 판정을 고치면 그 내용을 보내고(기본으로 켜져 있고 끌 수 있다), 검토를 거쳐 공개된 묶음을 받아 온다.
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
  // 기본으로 보내고, 사용자가 끈 경우에만 보내지 않는다.
  if (shareFeedback === false) return;
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
  const replace = (Array.isArray(body?.replace) ? body.replace : [])
    .filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string")
    .filter(([from, to]) => from.length > 0 && from.length <= 40 && to.length > 0 && to.length <= 40)
    .slice(0, 2000)
    .map(([from, to]) => [from, to]);
  return { version: Number.isInteger(body?.version) ? body.version : 0, examples, remove: phrases(body?.remove), keep: phrases(body?.keep), replace };
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

// ── 개선 모델 받기 ────────────────────────────────────────────────────────
// 사용자들이 고친 내용으로 서버가 다시 학습한 모델을 하루 한 번 확인해 받는다.
// 모델은 실행 코드가 아니라 가중치와 계산 그래프(ONNX)이고, 확장에 든 실행기(onnxruntime-web)로만 돌린다.
// 개발자의 서명 키로 서명된 것만 받는다. 서버가 뚫려도 서명 없는 모델은 쓰지 않는다.
const MODEL_KEY = __MODEL_KEY__;
const MODEL_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function syncModel() {
  if (!API_BASE || !MODEL_KEY) return;
  const { modelCheckedAt = 0 } = await chrome.storage.local.get("modelCheckedAt");
  if (Date.now() - modelCheckedAt < MODEL_INTERVAL_MS) return;
  await chrome.storage.local.set({ modelCheckedAt: Date.now() });

  const res = await fetch(`${API_BASE}/v1/model/manifest.json`, { cache: "no-store" });
  if (!res.ok) return;
  const manifest = await res.json();
  const valid =
    Number.isInteger(manifest?.version) &&
    /^[0-9a-f]{64}$/.test(manifest.sha256 ?? "") &&
    Number.isInteger(manifest.size) &&
    manifest.size > 0 &&
    manifest.size <= MODEL_MAX_BYTES &&
    typeof manifest.meta === "string" &&
    typeof manifest.signature === "string" &&
    typeof manifest.file === "string" &&
    /^\/v1\/model\/files\/[0-9a-f]{64}\.onnx$/.test(manifest.file);
  if (!valid) return;

  const bundled = await fetch(chrome.runtime.getURL("models/student/emotionless.json")).then((r) => r.json());
  const stored = await loadStoredModel();
  if (manifest.version <= Math.max(bundled.version ?? 1, stored?.version ?? 0)) return;
  if (!(await verifyModelSignature(manifest, MODEL_KEY))) return;
  const meta = JSON.parse(manifest.meta);
  const vocab = await fetch(chrome.runtime.getURL("models/student/vocab.txt")).then((r) => r.text());
  const vocabSha256 = await sha256Hex(new TextEncoder().encode(vocab));
  if (meta.version !== manifest.version || !compatibleMeta(meta, { labels: bundled.labels, vocabSha256 })) return;

  const file = await fetch(`${API_BASE}${manifest.file}`, { cache: "no-store" });
  if (!file.ok) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== manifest.size || (await sha256Hex(bytes)) !== manifest.sha256) return;
  await storeModel({ version: manifest.version, sha256: manifest.sha256, meta, bytes });
  // 이미 떠 있는 오프스크린 문서에 알려 다음 판정부터 새 모델을 쓰게 한다.
  if (await chrome.offscreen.hasDocument()) chrome.runtime.sendMessage({ target: "offscreen", type: "reload-model" }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "feedback") sendFeedback(msg.payload).catch(() => {});
  else if (msg?.type === "sync-shared") {
    syncShared().catch(() => {});
    syncModel().catch(() => {});
  }
  return false;
});
