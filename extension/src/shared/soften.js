// 거친 표현을 순한 표현으로 바꾸는 규칙 (soften.json). 지우면 문장이 어색해지는 말을 바꿔 뜻을 살린다.
import data from "./soften.json" with { type: "json" };

const RULES = data.rules.map(({ pattern, to }) => ({ re: new RegExp(pattern, "g"), to }));

const fill = (to, match) => to.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? "");

/**
 * 글에서 규칙에 맞는 자리와 바꿀 말. 겹치면 앞 규칙이 이긴다.
 * @returns {[number, number, string][]}
 */
export function softenSpans(text) {
  const spans = [];
  const taken = new Uint8Array(text.length);
  for (const { re, to } of RULES) {
    for (const match of text.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start || taken.subarray(start, end).some(Boolean)) continue;
      taken.fill(1, start, end);
      spans.push([start, end, fill(to, match)]);
    }
  }
  return spans.sort((a, b) => a[0] - b[0]);
}

/** 고치기 메뉴에서 권할 바꿀 말. 규칙에 맞지 않으면 빈 글을 돌려준다. */
export function suggestSoftening(phrase) {
  const spans = softenSpans(phrase);
  if (!spans.length) return "";
  let out = "";
  let at = 0;
  for (const [start, end, to] of spans) {
    out += phrase.slice(at, start) + to;
    at = end;
  }
  return (out + phrase.slice(at)).replace(/\s+/g, " ").trim();
}
