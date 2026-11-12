// BERT 방식 WordPiece 토크나이저. 감정 모델(KcELECTRA)의 토크나이저와 같은 결과를 내고,
// 각 토큰이 원문의 어느 글자에서 왔는지(자리)도 함께 돌려준다. 지울 부분을 글자 단위로 되돌릴 때 쓴다.
// 설정: 소문자로 바꾸지 않음, 악센트를 지우지 않음, 한자는 한 글자씩 나눔, 제어 문자는 버림.

const MAX_CHARS_PER_WORD = 100;

const isWhitespace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || /\p{Zs}/u.test(ch);
const isControl = (ch) => ch !== "\t" && ch !== "\n" && ch !== "\r" && /\p{C}/u.test(ch);

function isPunctuation(ch) {
  const cp = ch.codePointAt(0);
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
  return /\p{P}/u.test(ch);
}

function isChinese(cp) {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) ||
    (cp >= 0x2b740 && cp <= 0x2b81f) ||
    (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f)
  );
}

/** vocab.txt 의 내용(한 줄에 토큰 하나, 줄 번호가 id)으로 토크나이저를 만든다. */
export function createTokenizer(vocabText) {
  const vocab = new Map();
  vocabText.split("\n").forEach((line, index) => {
    const token = line.replace(/\r$/, "");
    if (token && !vocab.has(token)) vocab.set(token, index);
  });
  const id = (token) => vocab.get(token);
  const UNK = id("[UNK]");
  const CLS = id("[CLS]");
  const SEP = id("[SEP]");
  const PAD = id("[PAD]") ?? 0;

  // 원문을 낱말로 나눈다. 낱말마다 글자들과 각 글자의 원문 자리(UTF-16 기준)를 함께 둔다.
  function words(text) {
    const out = [];
    let current = null;
    const flush = () => {
      if (current) out.push(current);
      current = null;
    };
    let offset = 0;
    for (const ch of text) {
      const start = offset;
      offset += ch.length;
      const cp = ch.codePointAt(0);
      if (cp === 0 || cp === 0xfffd || isControl(ch)) continue;
      if (isWhitespace(ch)) {
        flush();
        continue;
      }
      if (isChinese(cp) || isPunctuation(ch)) {
        flush();
        out.push({ chars: [ch], starts: [start], end: offset });
        continue;
      }
      current ??= { chars: [], starts: [], end: start };
      current.chars.push(ch);
      current.starts.push(start);
      current.end = offset;
    }
    flush();
    return out;
  }

  // 낱말 하나를 가장 긴 조각부터 맞춰 나눈다. 하나라도 못 맞추면 낱말 전체가 [UNK] 다.
  function pieces(word) {
    const { chars, starts, end } = word;
    if (chars.length > MAX_CHARS_PER_WORD) return [{ id: UNK, start: starts[0], end }];
    const out = [];
    let begin = 0;
    while (begin < chars.length) {
      let stop = chars.length;
      let found = null;
      while (begin < stop) {
        const piece = (begin > 0 ? "##" : "") + chars.slice(begin, stop).join("");
        const pieceId = id(piece);
        if (pieceId !== undefined) {
          found = pieceId;
          break;
        }
        stop--;
      }
      if (found === null) return [{ id: UNK, start: starts[0], end }];
      out.push({ id: found, start: starts[begin], end: stop < chars.length ? starts[stop] : end });
      begin = stop;
    }
    return out;
  }

  /**
   * @param {string} text
   * @param {number} [maxLength] [CLS]·[SEP] 를 포함한 최대 길이
   * @returns {{ids: number[], offsets: [number, number][]}} 특수 토큰의 자리는 [0, 0]
   */
  function encode(text, maxLength = 128) {
    const tokens = words(text).flatMap(pieces).slice(0, maxLength - 2);
    return {
      ids: [CLS, ...tokens.map((t) => t.id), SEP],
      offsets: [[0, 0], ...tokens.map((t) => [t.start, t.end]), [0, 0]],
    };
  }

  return { encode, PAD, size: vocab.size };
}
