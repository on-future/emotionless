// 규칙 기반 감정 표현 삭제 (초안). 문장을 새로 쓰지 않고 지우기만 한다.

const HANGUL = "가-힣";
// 한글에는 \b 가 통하지 않으므로, 앞뒤가 한글이 아닌 경우만 독립된 단어로 본다.
const word = (alts) => new RegExp(`(?<![${HANGUL}])(?:${alts.join("|")})(?![${HANGUL}])`, "g");

const PROFANITY = [
  "시발", "씨발", "씨바", "시바", "ㅅㅂ", "ㅆㅂ", "존나", "졸라", "ㅈㄴ", "좆", "병신", "ㅂㅅ",
  "지랄", "ㅈㄹ", "개새끼", "새끼", "미친놈", "미친년", "ㅁㅊ", "꺼져", "닥쳐", "이딴", "염병",
];

// 문장 어디에 있어도 지우는 강조어·감탄사
const INTENSIFIERS = [
  "진짜", "정말", "너무", "완전", "솔직히", "제발 좀", "제발", "대박", "헐", "와", "아 네", "참",
  "미쳤다", "미쳤음", "레알", "ㄹㅇ", "개", "도대체", "대체",
];

// 문장 맨 앞에서만 지우는 말
const LEADING = ["아니", "아", "어휴", "에휴", "하", "야", "와"];

// 사실 없이 감정만 담은 관용 표현
const EMOTIVE_PHRASES = [
  "답답해 죽겠네", "미쳐버릴 것 같아요", "눈물남", "역겹다", "최악", "제정신임", "양심 어디갔냐",
  "수준 알만하다", "박수 쳐드려야겠네", "말이 됩니까", "말이 되냐고", "이게 기사냐",
];

const RE_PROFANITY = new RegExp(PROFANITY.join("|"), "g");
const RE_INTENS = word(INTENSIFIERS);
const RE_LEADING = new RegExp(`^(?:(?:${LEADING.join("|")})(?![${HANGUL}])[\\s,~]*)+`);
const RE_PHRASES = new RegExp(`(?:${EMOTIVE_PHRASES.join("|")})[?!.~]*`, "g");
const RE_JAMO = /[ㄱ-ㅎㅏ-ㅣ]+/g; // ㅋㅋ, ㅠㅠ, ㅎㅎ, 초성체
const RE_EMOJI = /[\p{Extended_Pictographic}️‍]|\^\^+|;;+/gu;

export function strip(text) {
  let s = text;
  s = s.replace(RE_EMOJI, " ");
  s = s.replace(RE_PROFANITY, " ");
  s = s.replace(RE_JAMO, " ");
  s = s.replace(RE_PHRASES, " ");
  s = s.replace(RE_INTENS, " ");
  // 문장 부호 정리: 반복 느낌표·물결·말줄임표
  s = s.replace(/~+/g, " ").replace(/!+/g, ".").replace(/\?[?!]*/g, "?").replace(/\.{2,}|…+/g, ".");
  // 문장 단위로 앞머리 감탄사 제거
  s = s
    .split(/(?<=[.?])\s*/)
    .map((part) => part.trim().replace(RE_LEADING, "").trim())
    .filter((part) => /[가-힣A-Za-z0-9]/.test(part))
    .join(" ");
  s = s.replace(/\s+/g, " ").replace(/\s+([.?,])/g, "$1").trim();
  if (s && !/[.?]$/.test(s)) s += ".";
  return s;
}
