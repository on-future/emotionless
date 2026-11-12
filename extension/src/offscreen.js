// 오프스크린 문서: 확장에 포함된 작은 모델로 댓글을 판정한다. 외부로 나가는 요청이 없다.
// 모델 한 번으로 두 가지를 낸다: 감정 44개(문장마다), 지울지 말지(토큰마다).
import * as ort from "onnxruntime-web/wasm";
import { classify, toVector, LABELS } from "./shared/emotion.js";
import { createTokenizer } from "./shared/wordpiece.js";

const MODEL_DIR = chrome.runtime.getURL("models/student/");
const MAX_TOKENS = 128;
// 이보다 지울 확률이 높은 토큰을 지운다.
const DELETE_THRESHOLD = 0.5;

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
// 여러 스레드는 페이지가 격리된 경우에만 쓸 수 있다. 코어가 적은 기기를 고려해 최대 4개까지만 쓴다.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

let ready = null;

async function load() {
  const [vocab, meta, session] = await Promise.all([
    fetch(`${MODEL_DIR}vocab.txt`).then((r) => r.text()),
    fetch(`${MODEL_DIR}emotionless.json`).then((r) => r.json()),
    ort.InferenceSession.create(`${MODEL_DIR}onnx/model_quantized.onnx`, { executionProviders: ["wasm"] }),
  ]);
  // 모델의 감정 라벨 순서가 확장의 순서와 같은지 확인한다 (다르면 감정이 엉뚱하게 붙는다).
  if (JSON.stringify(meta.labels) !== JSON.stringify(LABELS)) throw new Error("모델의 감정 라벨 순서가 확장과 다릅니다");
  return { tokenizer: createTokenizer(vocab), session };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/** 지울 토큰들의 자리를 이어 붙여 [시작, 끝] 목록으로 만든다. logits 는 토큰마다 [남김, 지움] 두 값이다. */
function deleteSpans(offsets, logits) {
  const spans = [];
  for (let t = 0; t < offsets.length; t++) {
    const [start, end] = offsets[t];
    if (end <= start) continue;
    if (sigmoid(logits[t * 2 + 1] - logits[t * 2]) < DELETE_THRESHOLD) continue;
    const last = spans.at(-1);
    // 사이에 공백 한 칸만 있으면 하나로 잇는다.
    if (last && start - last[1] <= 1) last[1] = end;
    else spans.push([start, end]);
  }
  return spans;
}

// 요청이 겹치지 않도록 한 줄로 세운다.
let queue = Promise.resolve();

async function run(texts) {
  ready ??= load();
  const { tokenizer, session } = await ready;
  const started = performance.now();
  // 한 문장씩 돌린다. 묶으면 가장 긴 문장 길이에 맞춰 채우느라 짧은 댓글이 많을 때 오히려 느리다.
  const results = [];
  for (const text of texts) {
    const { ids, offsets } = tokenizer.encode(text, MAX_TOKENS);
    const shape = [1, ids.length];
    const output = await session.run({
      input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
      attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
      token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape),
    });
    const emotion = output.emotion.data;
    const scores = Object.fromEntries(LABELS.map((label, i) => [label, sigmoid(emotion[i])]));
    results.push({ group: classify(scores), v: toVector(scores), del: deleteSpans(offsets, output.tags.data) });
  }
  return { results, ms: Math.round(performance.now() - started), threads: ort.env.wasm.numThreads };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "classify") return false;
  queue = queue
    .then(() => run(msg.texts))
    .then(sendResponse, (err) => {
      // 불러오기에 실패했으면 다음 요청 때 다시 시도한다.
      ready = null;
      sendResponse({ error: String(err?.message ?? err) });
    });
  return true;
});
