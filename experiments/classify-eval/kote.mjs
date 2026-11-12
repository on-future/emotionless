// KOTE(한국어 댓글 감정 44종) 모델의 라벨과 속도 확인. fp32와 q8을 비교한다.
import { pipeline, env } from "@huggingface/transformers";
import { SAMPLES } from "../model-eval/samples.js";

env.localModelPath = new URL("../../extension/models/", import.meta.url).pathname;
env.allowRemoteModels = false;

for (const dtype of ["fp32", "q8"]) {
  console.log(`\n## kote (${dtype})`);
  const clf = await pipeline("text-classification", "kote", { dtype });
  await clf("준비 운동");
  const times = [];
  for (const s of SAMPLES) {
    const t = performance.now();
    const top = await clf(s.text, { top_k: 4 });
    times.push(performance.now() - t);
    console.log(`[${s.kind}] ${top.map((r) => `${r.label} ${r.score.toFixed(2)}`).join(", ")}`);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`개별 호출: 평균 ${avg.toFixed(1)}ms, 최대 ${Math.max(...times).toFixed(1)}ms`);
}
