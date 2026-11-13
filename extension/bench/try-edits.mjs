// 모델 폴더 하나로 문장을 확장과 똑같이 판정·순화해 본다. 사용: node bench/try-edits.mjs <모델 폴더> < 문장.txt
import { readFileSync } from "node:fs";
import * as ort from "onnxruntime-node";
const X = new URL("../src/shared/", import.meta.url).href;
const { createTokenizer } = await import(X + "wordpiece.js");
const { editSpans } = await import(X + "edits.js");
const { cleanText } = await import(X + "clean.js");
const { classify, LABELS } = await import(X + "emotion.js");
const D = process.argv[2];
const meta = JSON.parse(readFileSync(D + "/emotionless.json", "utf8"));
const tok = createTokenizer(readFileSync(D + "/vocab.txt", "utf8"));
const session = await ort.InferenceSession.create(D + "/onnx/model_quantized.onnx");
const sig = (x) => 1 / (1 + Math.exp(-x));
for (const text of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
  const { ids, offsets } = tok.encode(text, 128);
  const shape = [1, ids.length];
  const out = await session.run({ input_ids: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), shape), attention_mask: new ort.Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape), token_type_ids: new ort.Tensor("int64", new BigInt64Array(ids.length), shape) });
  const scores = Object.fromEntries(LABELS.map((l, i) => [l, sig(out.emotion.data[i])]));
  const { del, rep } = editSpans(offsets, out.tags.data, meta.tags ?? ["keep", "delete"]);
  console.log(`${classify(scores).padEnd(9)} ${text}\n          → ${cleanText(text, del, {}, rep)}`);
}
