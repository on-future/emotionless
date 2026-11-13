// 서버에서 받은 개선 모델을 보관하는 곳. 서비스 워커(받기)와 오프스크린 문서(쓰기)가 함께 쓴다.
// 오프스크린 문서는 chrome.storage 를 쓸 수 없으므로 둘 다 쓸 수 있는 Cache Storage 에 둔다.
// Cache Storage 는 http(s) 주소만 열쇠로 받으므로 실제로 접속하지 않는 주소를 열쇠로 쓴다.

export const MODEL_CACHE = "eml-model";
const KEY_BASE = "https://model.emotionless.invalid/";
export const CURRENT_KEY = `${KEY_BASE}current.json`;
export const fileKey = (sha256) => `${KEY_BASE}${sha256}.onnx`;

export const MODEL_MAX_BYTES = 64 * 1024 * 1024;
const TAG_MAX = 40;
const TAG_LIMIT = 512;

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 받은 모델의 설명이 이 확장과 맞는지 본다. 감정 라벨 순서와 토크나이저 단어장이 같아야 하고,
 * 토큰마다 내는 값(tags)은 [남김, 지움, 바꿀 말...] 이어야 한다.
 * @returns {boolean}
 */
export function compatibleMeta(meta, { labels, vocabSha256 }) {
  if (!meta || typeof meta !== "object") return false;
  if (JSON.stringify(meta.labels) !== JSON.stringify(labels)) return false;
  if (meta.vocab_sha256 !== vocabSha256) return false;
  if (!Number.isInteger(meta.version) || meta.version < 1) return false;
  const tags = meta.tags ?? ["keep", "delete"];
  if (!Array.isArray(tags) || tags.length < 2 || tags.length > TAG_LIMIT || tags[0] !== "keep" || tags[1] !== "delete") return false;
  return tags.slice(2).every((t) => typeof t === "string" && t.length > 0 && t.length <= TAG_MAX);
}

/** 보관해 둔 모델. 없거나 파일이 손상됐으면 null. @returns {Promise<{version: number, meta: object, bytes: Uint8Array} | null>} */
export async function loadStoredModel() {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const current = await cache.match(CURRENT_KEY);
    if (!current) return null;
    const info = await current.json();
    const file = await cache.match(fileKey(info.sha256));
    if (!file) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ((await sha256Hex(bytes)) !== info.sha256) return null;
    return { version: info.version, meta: info.meta, bytes };
  } catch {
    return null;
  }
}

/** 받은 모델을 보관하고, 예전 모델 파일은 지운다. */
export async function storeModel({ version, sha256, meta, bytes }) {
  const cache = await caches.open(MODEL_CACHE);
  await cache.put(fileKey(sha256), new Response(bytes, { headers: { "content-type": "application/octet-stream" } }));
  await cache.put(CURRENT_KEY, new Response(JSON.stringify({ version, sha256, meta }), { headers: { "content-type": "application/json" } }));
  for (const request of await cache.keys()) {
    if (request.url !== CURRENT_KEY && request.url !== fileKey(sha256)) await cache.delete(request);
  }
}

/** 보관한 모델을 지운다 (불러오다 실패했을 때 기본 모델로 돌아가기 위해). */
export async function dropStoredModel() {
  await caches.delete(MODEL_CACHE).catch(() => {});
}

const MODEL_SIGN_PREFIX = "emotionless-model/1";

/** 서명하는 글: 버전, 파일의 SHA-256, 크기, 모델 설명(JSON 문자열 그대로). 서버의 서명 스크립트(publish-model.mjs, nightly.py)와 같아야 한다. */
export const modelSignedText = ({ version, sha256, size, meta }) => [MODEL_SIGN_PREFIX, version, sha256, size, meta].join("\n");

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** 모델 설명의 서명을 확인한다. publicKeyX 는 Ed25519 공개 키(JWK 의 x). */
export async function verifyModelSignature(manifest, publicKeyX) {
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: publicKeyX }, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromBase64(manifest.signature), new TextEncoder().encode(modelSignedText(manifest)));
  } catch {
    // 이 브라우저가 Ed25519 를 지원하지 않으면 받지 않고 기본 모델을 쓴다.
    return false;
  }
}
