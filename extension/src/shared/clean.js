// 모델이 고른 "지울 부분"으로 순화한 글을 만든다. 문장을 새로 쓰지 않고 지우기만 한다.
// 지울 부분 = 모델이 고른 곳 + 늘 지우는 것(욕설·ㅋㅋ 등) + 사용자가 지우라고 한 표현
// 단, 주소와 사용자가 남기라고 한 표현은 지우지 않는다.
import { ruleSpans, splitUrls } from "./strip.js";

const HAS_WORD = /[가-힣A-Za-z0-9]/;
const LETTER = /[가-힣A-Za-z0-9]/;

/**
 * 모델은 토큰 단위로 고르기 때문에 낱말 중간에서 자를 때가 있다 ("개발자들" → "개발자").
 * 띄어쓰기로 나뉜 낱말마다 글자(한글·영문·숫자)를 절반 이상 지웠으면 그 낱말의 글자를 모두 지우고,
 * 절반 미만이면 글자는 모두 남긴다. 낱말에 붙은 ㅋㅋ·문장 부호 같은 나머지 글자는 모델의 판단을 그대로 따른다.
 */
function wholeWords(text, mark) {
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    let letters = 0;
    let deleted = 0;
    for (let i = start; i < end; i++) {
      if (!LETTER.test(text[i])) continue;
      letters++;
      deleted += mark[i];
    }
    if (!letters || !deleted || deleted === letters) continue;
    const value = deleted * 2 >= letters ? 1 : 0;
    for (let i = start; i < end; i++) if (LETTER.test(text[i])) mark[i] = value;
  }
}

function phraseSpans(text, phrases) {
  const spans = [];
  for (const phrase of phrases) {
    if (!phrase) continue;
    for (let i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + phrase.length)) {
      spans.push([i, i + phrase.length]);
    }
  }
  return spans;
}

function urlSpans(text) {
  const spans = [];
  let at = 0;
  for (const part of splitUrls(text)) {
    if (part.url) spans.push([at, at + part.text.length]);
    at += part.text.length;
  }
  return spans;
}

/** 남은 글을 다듬는다: 공백 정리, 같은 문장 부호 반복 줄이기, 앞에 남은 문장 부호 지우기. */
export function tidy(text) {
  let s = text.replace(/\s+/g, " ").trim();
  s = s.replace(/\s+([.,?!…~])/g, "$1");
  s = s.replace(/([.!?…~])[.!?…~]+/g, "$1");
  s = s.replace(/,(?=[.!?])/g, "");
  s = s.replace(/^[\s.,!?~…·:;\-]+/, "");
  return HAS_WORD.test(s) ? s : "";
}

/**
 * @param {string} text 원문
 * @param {[number, number][]} modelSpans 모델이 지우라고 고른 자리
 * @param {{remove?: string[], keep?: string[]}} [words] 사용자가 알려 준 표현
 */
export function cleanText(text, modelSpans = [], words = {}) {
  const mark = new Uint8Array(text.length);
  const set = (spans, value) => {
    for (const [start, end] of spans) mark.fill(value, Math.max(0, start), Math.min(text.length, end));
  };
  set(modelSpans, 1);
  wholeWords(text, mark);
  set(ruleSpans(text), 1);
  set(phraseSpans(text, words.remove ?? []), 1);
  set(phraseSpans(text, words.keep ?? []), 0);
  set(urlSpans(text), 0);
  let kept = "";
  for (let i = 0; i < text.length; i++) kept += mark[i] ? " " : text[i];
  return tidy(kept);
}
