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
const RE_URL = /https?:\/\/[^\s<>"']+/g;
const HOLD = "\u0002";

export function strip(text) {
  const urls = [];
  let s = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(RE_URL, (url) => `${HOLD}${urls.push(url) - 1}${HOLD}`);
  // 글 중간의 ㅋㅋ·ㅠㅠ 는 문장 경계 역할을 하므로 마침표로 바꾼다.
  s = s.replace(RE_NOISE, MARK).replace(RE_MARK_BETWEEN, "$1. ").replaceAll(MARK, " ");
  s = s.replace(RE_PROFANITY, " ");
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  s = s.replace(RE_INTENS, " ");
  s = s.replace(/~+/g, " ").replace(/!+/g, ". ").replace(/\?[?!.]*/g, "?").replace(/\.{2,}|…+/g, ".");

  const parts = [];
  // 마침표 뒤에 공백이 있을 때만 문장 끝으로 본다 ("3.5점", "11.12" 는 그대로 둔다).
  for (const raw of s.split(/(?<=[.?])\s+/)) {
    const end = /[.?]$/.test(raw) ? raw.at(-1) : "";
    let body = (end ? raw.slice(0, -1) : raw).replace(/\s+/g, " ").trim();
    body = body.replace(RE_LEADING, "").trim();
    body = body.replace(RE_TAIL, "").trim();
    if (!new RegExp(`[${RE_WORDCHAR}${HOLD}]`).test(body)) continue;
    // 주소로 끝나는 문장에는 마침표를 붙이지 않는다.
    parts.push(body + (end || (body.endsWith(HOLD) ? "" : ".")));
  }
  return parts.join(" ").replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, i) => urls[Number(i)]);
}

// 욕설이 들어 있는지 (분류 모델이 짧은 욕설 댓글을 중립으로 볼 때 보정하는 데 쓴다)
export function hasProfanity(text) {
  return new RegExp(PROFANITY.join("|")).test(text) || /ㅅㅂ|ㅆㅂ|ㅂㅅ|ㅈㄴ|ㅈㄹ|ㅁㅊ/.test(text);
}

const normalize = (t) => t.replace(/\s+/g, " ").trim().replace(/[.]$/, "");

// 순화 결과가 원문과 사실상 같은지 (마침표·공백 차이는 무시)
export function isUnchanged(original, cleaned) {
  return normalize(original) === normalize(cleaned);
}
