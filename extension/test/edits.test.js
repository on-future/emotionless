import { test } from "node:test";
import assert from "node:assert/strict";
import { editSpans } from "../src/shared/edits.js";
import { compatibleMeta, modelSignedText, verifyModelSignature } from "../src/shared/model-store.js";
import { generateKeyPairSync, sign } from "node:crypto";

// 토큰마다 [남김, 지움, 바꿀 말...] 점수. 고르고 싶은 칸만 높게 준다.
const logits = (picks, width) => Float32Array.from(picks.flatMap((k) => Array.from({ length: width }, (_, i) => (i === k ? 5 : -5))));

test("editSpans: 지움 두 갈래 모델은 예전처럼 지울 자리만 낸다", () => {
  const offsets = [[0, 0], [0, 2], [3, 5], [6, 8], [0, 0]];
  assert.deepEqual(editSpans(offsets, logits([0, 1, 1, 0, 0], 2), ["keep", "delete"]), { del: [[0, 5]], rep: [] });
});

test("editSpans: 바꿀 말 토큰과 이어진 지움 토큰을 한 자리로 바꾼다", () => {
  const tags = ["keep", "delete", "정말", "사람"];
  // "존나 개 좋다" 같은 모양: 0-2 바꾸기(정말), 3-4 지움(앞 자리에 붙음), 5-7 남김
  const offsets = [[0, 0], [0, 2], [3, 4], [5, 7], [0, 0]];
  assert.deepEqual(editSpans(offsets, logits([0, 2, 1, 0, 0], 4), tags), { del: [], rep: [[0, 4, "정말"]] });
  // 같은 말로 바꾸라는 토큰이 이어지면 한 자리, 다른 말이면 따로
  const offsets2 = [[0, 0], [0, 1], [1, 2], [3, 5], [0, 0]];
  assert.deepEqual(editSpans(offsets2, logits([0, 3, 3, 2, 0], 4), tags), { del: [], rep: [[0, 2, "사람"], [3, 5, "정말"]] });
});

test("compatibleMeta: 라벨·단어장·출력 모양이 맞는 모델만 받는다", () => {
  const base = { labels: ["a", "b"], vocabSha256: "x" };
  const meta = { version: 2, labels: ["a", "b"], vocab_sha256: "x", tags: ["keep", "delete", "정말"] };
  assert.equal(compatibleMeta(meta, base), true);
  assert.equal(compatibleMeta({ ...meta, labels: ["b", "a"] }, base), false);
  assert.equal(compatibleMeta({ ...meta, vocab_sha256: "y" }, base), false);
  assert.equal(compatibleMeta({ ...meta, tags: ["delete", "keep"] }, base), false);
  assert.equal(compatibleMeta({ ...meta, tags: ["keep", "delete", "x".repeat(41)] }, base), false);
});

test("verifyModelSignature: 서버 쪽(Node crypto)이 서명한 설명을 확장(WebCrypto)이 확인한다", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x;
  const manifest = { version: 3, sha256: "a".repeat(64), size: 1234, meta: JSON.stringify({ version: 3, tags: ["keep", "delete", "정말"] }) };
  manifest.signature = sign(null, Buffer.from(modelSignedText(manifest)), privateKey).toString("base64");
  assert.equal(await verifyModelSignature(manifest, x), true);
  // 어느 하나라도 바뀌면 받지 않는다.
  assert.equal(await verifyModelSignature({ ...manifest, size: 1235 }, x), false);
  assert.equal(await verifyModelSignature({ ...manifest, meta: manifest.meta.replace("정말", "진짜") }, x), false);
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;
  assert.equal(await verifyModelSignature(manifest, other), false);
});
