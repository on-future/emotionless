// 분류 모델 속도·라벨 확인 + 규칙 기반 삭제 결과 출력.
// 사용: node run.mjs [strip|classify]
import { SAMPLES } from "../model-eval/samples.js";
import { strip } from "./strip.mjs";

const mode = process.argv[2] ?? "all";

if (mode === "all" || mode === "strip") {
  console.log("## 규칙 기반 삭제");
  const t0 = performance.now();
  const outs = SAMPLES.map((s) => strip(s.text));
  const ms = performance.now() - t0;
  SAMPLES.forEach((s, i) => console.log(`[${s.kind}]\n  원문: ${s.text}\n  결과: ${outs[i]}`));
  console.log(`총 ${ms.toFixed(2)}ms / ${SAMPLES.length}개`);
}

if (mode === "all" || mode === "classify") {
  const { pipeline } = await import("@huggingface/transformers");
  const CANDIDATES = [
    { id: "Xenova/kor_unsmile", dtype: "q8" },
    { id: "jdp8/multilingual_go_emotions-ONNX", dtype: "q8" },
  ];
  const texts = SAMPLES.map((s) => s.text);

  for (const { id, dtype } of CANDIDATES) {
    console.log(`\n## ${id} (${dtype})`);
    const t0 = performance.now();
    const clf = await pipeline("text-classification", id, { dtype });
    console.log(`로드 ${Math.round(performance.now() - t0)}ms`);
    await clf("준비 운동"); // 첫 호출은 초기화 비용이 섞이므로 제외

    const times = [];
    for (const s of SAMPLES) {
      const t1 = performance.now();
      const top = await clf(s.text, { top_k: 3 });
      times.push(performance.now() - t1);
      const labels = top.map((r) => `${r.label} ${r.score.toFixed(2)}`).join(", ");
      console.log(`[${s.kind}] ${labels}`);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`개별 호출: 평균 ${avg.toFixed(1)}ms, 최대 ${times.at(-1).toFixed(1)}ms`);

    const t2 = performance.now();
    await clf(texts, { top_k: 1 });
    const batch = performance.now() - t2;
    console.log(`일괄 호출: ${batch.toFixed(1)}ms / ${texts.length}개 (개당 ${(batch / texts.length).toFixed(1)}ms)`);
  }
}
