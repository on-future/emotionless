// 페이지에서 댓글 항목과 그 본문 요소를 찾는다.

const HINT = /comment|cmt|reply|replies|review|discuss|thread|댓글|답글|덧글|리플/i;
const TEXT_HINT = /content|contents|text|txt|body|message|msg|desc|usertxt/i;
const HANGUL = /[가-힣]/;
// 본문이 아닌 칸(작성자, 날짜, 배지, 버튼 줄 등)에 흔히 붙는 이름.
// 낱말 단위로만 견준다 ("timeline" 이 "time" 으로 걸리지 않게).
const NOT_TEXT_TOKENS = new Set([
  "badge", "badges", "pinned", "label", "author", "nick", "nickname", "name", "username", "date", "time",
  "datetime", "timestamp", "meta", "head", "header", "count", "like", "likes", "vote", "votes", "action",
  "actions", "toolbar", "button", "buttons", "btn",
]);
// 구조가 특이해 자동 감지가 어긋나는 주요 사이트는 위치를 정해 둔다.
// 규칙이 있는 사이트에서는 자동 감지를 쓰지 않는다 (댓글이 아직 안 불러와졌을 때 다른 영역을 잘못 잡지 않도록).
// skipPath 에 해당하는 화면은 규칙이 맞지 않으므로 자동 감지에 맡긴다.
const SITE_RULES = {
  "www.youtube.com": {
    item: "ytd-comment-view-model, ytd-comment-renderer",
    text: "#content-text",
    skipPath: /^\/live_chat/,
  },
  "m.youtube.com": { item: "ytm-comment-renderer", text: ".comment-text" },
};
// 댓글 항목이 될 수 없는 태그 (본문 안의 문단, 인라인 요소 등)
const NOT_ITEM = new Set([
  "P", "SPAN", "A", "BR", "B", "I", "EM", "STRONG", "IMG", "BUTTON", "INPUT", "SCRIPT", "STYLE",
  "SVG", "PATH", "OPTION", "TD", "TH", "LABEL",
]);
const NOT_TEXT_ANCESTOR = "a, button, [role=button], time, label, select, textarea, input, nav, .eml-view, .eml-pill";
// 본문 글의 일부로 치는 인라인 태그. 링크·버튼 안의 글은 메뉴나 제목일 가능성이 높아 세지 않는다.
const INLINE = new Set(["SPAN", "B", "I", "EM", "STRONG", "BR", "FONT", "U", "S", "MARK", "SMALL", "SUB", "SUP", "CODE", "WBR", "ABBR"]);
// 확장이 넣은 요소와, 순화본으로 대체되어 숨겨진 원문 요소
const OURS = ".eml-view, .eml-pill, [data-eml-hidden]";
const MIN_TEXT = 6;
// 숫자·기호·공백을 뺀 글자 수
const letterCount = (text) => text.replace(/[\d\s\p{P}\p{S}]/gu, "").length;
// 작성 시각처럼 보이는 글 (예: "11. 12 12:26:59 삭제")
const DATE_LIKE = /\d{1,2}:\d{2}|\d{4}[.\-/]\s?\d{1,2}|\d{1,2}[.\-/]\s?\d{1,2}/;
const MAX_TEXT = 3000;

const hintOf = (el) =>
  HINT.test(el.tagName) ||
  HINT.test(typeof el.className === "string" ? el.className : "") ||
  HINT.test(el.id || "") ||
  HINT.test(el.getAttribute("aria-label") || "");

function hintedNearby(el) {
  for (let cur = el, depth = 0; cur && cur !== document.documentElement && depth < 4; cur = cur.parentElement, depth++) {
    if (hintOf(cur)) return true;
  }
  return false;
}

const keyOf = (el) => `${el.tagName}|${el.classList[0] ?? ""}`;

// 요소 자신이 직접 가진 글 (블록 자식, 링크, 버튼 안의 글은 제외)
function ownText(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    else if (node.nodeType === Node.ELEMENT_NODE && INLINE.has(node.tagName.toUpperCase())) out += ownText(node);
  }
  return out.replace(/\s+/g, " ").trim();
}

function isNotText(el) {
  const cls = typeof el.className === "string" ? el.className : "";
  const name = `${cls} ${el.id || ""}`;
  if (TEXT_HINT.test(name)) return false;
  // "comment-head", "date_time", "userName" 을 낱말로 쪼갠다.
  const tokens = name.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/);
  return tokens.some((token) => NOT_TEXT_TOKENS.has(token.toLowerCase()));
}

// 댓글 항목 안에서 본문 요소를 고른다. 중첩된 다른 항목(답글)에 속한 요소는 건너뛴다.
function findTextEl(item, itemSet) {
  // 본문이 아닌 칸을 걸러 내고 찾되, 그래서 아무것도 못 찾으면 거르지 않고 다시 찾는다.
  return searchTextEl(item, itemSet, true) ?? searchTextEl(item, itemSet, false);
}

function searchTextEl(item, itemSet, skipNonText) {
  let best = null;
  let bestLen = 0;
  let hinted = null;
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_ELEMENT, {
    acceptNode(el) {
      if (el !== item && itemSet.has(el)) return NodeFilter.FILTER_REJECT;
      if (el.matches(NOT_TEXT_ANCESTOR)) return NodeFilter.FILTER_REJECT;
      if (skipNonText && el !== item && isNotText(el)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    const text = ownText(el);
    if (!text || text.length > MAX_TEXT) continue;
    const letters = letterCount(text);
    const cls = typeof el.className === "string" ? el.className : "";
    // 이름으로 본문임이 드러나는 요소는 아주 짧은 댓글이어도 본문으로 본다.
    if (!hinted && el !== item && letters > 0 && (TEXT_HINT.test(cls) || TEXT_HINT.test(el.id || ""))) hinted = el;
    if (text.length < MIN_TEXT) continue;
    // 날짜·시각 칸은 본문이 아니다.
    if (DATE_LIKE.test(text) && letters < 6) continue;
    if (letters > bestLen) {
      best = el;
      bestLen = letters;
    }
  }
  return hinted ?? best;
}

function findItemsAuto() {
  const items = [];
  const keys = new Set();
  for (const parent of document.body.querySelectorAll("*")) {
    if (parent.childElementCount < 2 || parent.closest(".eml-view, .eml-pill")) continue;
    const groups = new Map();
    for (const child of parent.children) {
      if (NOT_ITEM.has(child.tagName.toUpperCase()) || child.matches(OURS)) continue;
      const key = keyOf(child);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      // 대부분 글이 들어 있는 반복 블록이어야 댓글 목록으로 본다. 그중 한글이 있는 것만 처리 대상이다
      // (영어 댓글이 섞여 있거나 일부가 비어 있어도 목록 전체를 버리지 않는다).
      const filled = members.filter((m) => m.textContent.trim());
      if (filled.length < 2 || filled.length < members.length * 0.6) continue;
      const withText = filled.filter((m) => HANGUL.test(m.textContent));
      if (!withText.length) continue;
      const hintedMembers = members.filter(hintOf).length;
      if (!hintedNearby(parent) && hintedMembers < members.length * 0.6) continue;
      items.push(...withText);
      // 답글이 하나뿐인 목록처럼 반복되지 않아 놓친 같은 모양의 항목도 포함한다.
      const first = withText[0];
      if (first.classList[0]) keys.add(`${first.tagName.toLowerCase()}.${CSS.escape(first.classList[0])}`);
    }
  }
  if (keys.size) {
    const known = new Set(items);
    for (const el of document.body.querySelectorAll([...keys].join(","))) {
      if (!known.has(el) && !el.matches(OURS) && !el.closest(".eml-view, .eml-pill")) items.push(el);
    }
  }
  return items;
}

/**
 * @param {string|null} customSelector 사용자가 직접 지정한 댓글 항목 선택자
 * @returns {{item: Element, textEl: Element}[]}
 */
export function findComments(customSelector) {
  let items = [];
  if (customSelector) {
    try {
      items = [...document.querySelectorAll(customSelector)];
    } catch {
      items = [];
    }
  }
  if (!items.length) {
    const rule = SITE_RULES[location.hostname];
    if (rule && !rule.skipPath?.test(location.pathname)) {
      const out = [];
      for (const item of document.querySelectorAll(rule.item)) {
        const textEl = item.querySelector(rule.text);
        if (textEl && !textEl.closest(OURS)) out.push({ item, textEl });
      }
      return out;
    }
    items = findItemsAuto();
  }

  const itemSet = new Set(items);
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const textEl = findTextEl(item, itemSet);
    if (!textEl || seen.has(textEl)) continue;
    seen.add(textEl);
    out.push({ item, textEl });
  }
  return out;
}

// 사용자가 클릭한 요소에서 댓글 항목 선택자를 추정한다.
export function selectorFromClick(target) {
  let best = null;
  let bestCount = 1;
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    if (NOT_ITEM.has(el.tagName.toUpperCase()) || !el.parentElement) continue;
    const key = keyOf(el);
    const count = [...el.parentElement.children].filter((c) => keyOf(c) === key).length;
    if (count > bestCount) {
      best = el;
      bestCount = count;
    }
  }
  if (!best) return null;
  const part = (el) => el.tagName.toLowerCase() + (el.classList[0] ? `.${CSS.escape(el.classList[0])}` : "");
  return `${part(best.parentElement)} > ${part(best)}`;
}
