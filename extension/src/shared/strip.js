// 규칙 기반 감정 표현 삭제. 문장을 새로 쓰지 않고, 확실한 감정 표현만 지운다.
// 서술어는 건드리지 않는다 (지우면 문장이 끊기므로).

const H = "가-힣";
// 한글에는 \b 가 통하지 않으므로, 앞뒤가 한글이 아닌 경우만 독립된 단어로 본다.
const standalone = (alts) => new RegExp(`(?<![${H}])(?:${alts.join("|")})(?![${H}])`, "g");

const PROFANITY = [
  "시발", "씨발", "씨바", "시바", "존나", "졸라", "좆", "병신", "지랄", "개새끼", "새끼",
  "미친놈", "미친년", "꺼져", "닥쳐", "염병",
];

const REPLACEMENTS = [[/이딴/g, "이런"]];

const INTENSIFIERS = [
  "진짜", "정말", "너무", "완전", "솔직히", "제발 좀", "제발", "대박", "헐", "레알", "도대체",
  "미쳤다", "참",
];

// 문장 맨 앞에서만 지우는 감탄사
const LEADING = ["아니", "아 네", "아", "와", "어휴", "에휴", "하", "야"];

// 문장 끝이나 단독으로 쓰여 감정만 전하는 말
const TAILS = ["최악", "역겹다", "눈물남", "답답해 죽겠네", "수준 알만하다", "어이없네", "극혐"];

const MARK = "\u0001";
// 욕설 뒤에 붙는 말(년, 놈, 같은 등)까지 함께 지워 조각이 남지 않게 한다.
const RE_PROFANITY = new RegExp(`(?:${PROFANITY.join("|")})(?:년|놈|새끼|들|아|같은|같이|같네|이네|이냐)*`, "g");
const RE_INTENS = standalone(INTENSIFIERS);
const RE_LEADING = new RegExp(`^(?:(?:${LEADING.join("|")})(?![${H}])[\\s,]*)+`);
const RE_TAIL = new RegExp(`(?:^|\\s+)(?:${TAILS.join("|")})$`);
// ㅋㅋ, ㅠㅠ, 초성체, 이모지, ^^, ;;
const RE_NOISE = /[ㄱ-ㅎㅏ-ㅣ]+|[\p{Extended_Pictographic}️‍]+|\^\^+|;;+/gu;
const RE_WORDCHAR = `${H}0-9A-Za-z`;
const RE_MARK_BETWEEN = new RegExp(`([${RE_WORDCHAR}])\\s*${MARK}+\\s*(?=[${RE_WORDCHAR}])`, "g");

// 주소는 건드리지 않도록 잠시 빼 두었다가 마지막에 되돌린다.
// 주소에 쓸 수 있는 ASCII 문자만 주소로 본다 (뒤에 붙은 한글·ㅋㅋ 는 주소가 아니다).
const RE_URL = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;
const HOLD = "\u0002";
const RE_HELD = new RegExp(`${HOLD}(\\d+)${HOLD}`, "g");
const RE_HAS_WORD = new RegExp(`[${RE_WORDCHAR}${HOLD}]`);
// 한글 사이에 띄어쓰기 없이 찍힌 마침표 ("최악.다시는")
const RE_TIGHT_PERIOD = new RegExp(`([${H}])\\.(?=[${H}])`, "g");
const RE_PROFANITY_ANY = new RegExp(`${PROFANITY.join("|")}|ㅅㅂ|ㅆㅂ|ㅂㅅ|ㅈㄴ|ㅈㄹ|ㅁㅊ`);

// 주소 끝에 붙은 문장 부호와 짝이 없는 닫는 괄호는 주소가 아니다.
function trimUrl(url) {
  let out = url;
  for (;;) {
    const trimmed = out.replace(/[.,!?;:'"]+$/, "");
    const next = trimmed.endsWith(")") && !trimmed.includes("(") ? trimmed.slice(0, -1) : trimmed;
    if (next === out) return out;
    out = next;
  }
}

/**
 * 글을 주소와 주소가 아닌 부분으로 나눈다.
 * @returns {{text: string, url: boolean}[]}
 */
export function splitUrls(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(RE_URL)) {
    const url = trimUrl(match[0]);
    if (match.index > last) parts.push({ text: text.slice(last, match.index), url: false });
    parts.push({ text: url, url: true });
    last = match.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), url: false });
  return parts;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRegExp = (phrases) =>
  phrases.length ? new RegExp(phrases.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|"), "g") : null;

/**
 * @param {string} text
 * @param {{remove?: string[], keep?: string[]}} [words] 사용자가 알려 준 표현.
 *   remove: 더 지울 표현, keep: 지우지 말아야 할 표현 (keep 이 우선한다)
 */
export function strip(text, words = {}) {
  const urls = [];
  const hold = (value) => `${HOLD}${urls.push(value) - 1}${HOLD}`;
  let s = splitUrls(text.replace(/\s+/g, " ").trim())
    .map((part) => (part.url ? hold(part.text) : part.text))
    .join("");
  // 남기라고 한 표현은 주소처럼 빼 두어 어떤 규칙에도 걸리지 않게 하고, 지우라고 한 표현은 먼저 지운다.
  const keep = phraseRegExp(words.keep ?? []);
  if (keep) s = s.replace(keep, (phrase) => hold(phrase));
  const remove = phraseRegExp(words.remove ?? []);
  if (remove) s = s.replace(remove, " ");
  // 글 중간의 ㅋㅋ·ㅠㅠ 는 문장 경계 역할을 하므로 마침표로 바꾼다.
  s = s.replace(RE_NOISE, MARK).replace(RE_MARK_BETWEEN, "$1. ").replaceAll(MARK, " ");
  s = s.replace(RE_PROFANITY, " ");
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  s = s.replace(RE_INTENS, " ");
  // 문장 부호를 정리한다. 뒤에 공백을 넣어, 붙여 쓴 글도 문장 단위로 나뉘게 한다.
  s = s
    .replace(/~+/g, " ")
    .replace(/!+/g, ". ")
    .replace(/\?[?!.]*/g, "? ")
    .replace(/\.{2,}|…+/g, ". ")
    .replace(RE_TIGHT_PERIOD, "$1. ");

  const parts = [];
  // 마침표 뒤에 공백이 있을 때만 문장 끝으로 본다 ("3.5점", "11.12" 는 그대로 둔다).
  for (const raw of s.split(/(?<=[.?])\s+/)) {
    const end = /[.?]$/.test(raw) ? raw.at(-1) : "";
    let body = (end ? raw.slice(0, -1) : raw).replace(/\s+/g, " ").trim();
    body = body.replace(RE_LEADING, "").trim();
    body = body.replace(RE_TAIL, "").trim();
    if (!RE_HAS_WORD.test(body)) continue;
    // 주소로 끝나는 문장에는 마침표를 붙이지 않는다.
    parts.push(body + (end || (body.endsWith(HOLD) ? "" : ".")));
  }
  return parts.join(" ").replace(RE_HELD, (_, i) => urls[Number(i)]);
}

/**
 * 모델과 상관없이 늘 지우는 부분(욕설, ㅋㅋ·ㅠㅠ·초성체, 이모지, ^^, ;;)의 자리.
 * 모델이 놓치더라도 이것들은 확실히 지운다.
 * @returns {[number, number][]}
 */
export function ruleSpans(text) {
  const spans = [];
  for (const re of [RE_PROFANITY, RE_NOISE]) {
    for (const match of text.matchAll(re)) spans.push([match.index, match.index + match[0].length]);
  }
  return spans;
}

// 욕설이 들어 있는지 (분류 모델이 짧은 욕설 댓글을 중립으로 볼 때 보정하는 데 쓴다)
export function hasProfanity(text) {
  return RE_PROFANITY_ANY.test(text);
}

const normalize = (t) => t.replace(/\s+/g, " ").trim().replace(/[.]$/, "");

// 순화 결과가 원문과 사실상 같은지 (마침표·공백 차이는 무시)
export function isUnchanged(original, cleaned) {
  return normalize(original) === normalize(cleaned);
}
