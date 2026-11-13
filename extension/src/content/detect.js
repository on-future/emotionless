// 페이지에서 댓글 항목과 그 본문 요소를 찾는다.
//
// 본문 위치는 댓글 하나만 보고 정하지 않고, 같은 모양으로 반복되는 댓글 목록 전체를 보고 정한다.
// 댓글마다 "항목 안에서의 자리"(태그·클래스 경로)별로 글을 모은 뒤, 거의 모든 댓글에 있고
// 글이 길고 댓글마다 내용이 다른 자리를 본문 자리로 고른다. 그래서
//  - 닉네임·날짜 칸은 목록 전체로 보면 짧고 이름이 드러나므로 본문으로 뽑히지 않고,
//  - "응원합니다"처럼 짧은 댓글도 본문 자리에 있으니 빠지지 않는다.

const HINT = /comment|cmt|reply|replies|review|discuss|thread|댓글|답글|덧글|리플/i;
const TEXT_HINT = /content|contents|text|txt|body|message|msg|desc|usertxt/i;
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;
// 본문이 아닌 칸(작성자, 날짜, 배지, 버튼 줄 등)에 흔히 붙는 이름. 낱말 단위로만 견준다.
const NOT_TEXT_TOKENS = new Set([
  "badge", "badges", "pinned", "label", "author", "nick", "nickname", "name", "username", "user", "userid",
  "writer", "handle", "profile", "avatar", "level", "grade", "date", "time", "datetime", "timestamp", "ago",
  "meta", "info", "head", "header", "count", "like", "likes", "vote", "votes", "recommend", "action",
  "actions", "toolbar", "button", "buttons", "btn", "menu", "tag", "tags", "title",
]);
// 글자 크기·색·여백처럼 모양만 정하는 클래스 (Tailwind 등). 이름이 "text-" 로 시작해도 본문이라는 뜻이 아니다.
const UTILITY_CLASS =
  /[:[]|^-?(text|font|leading|tracking|bg|from|to|via|p[xytrbl]?|m[xytrbl]?|w|h|min|max|size|gap|space|flex|grid|col|row|items|justify|self|place|order|rounded|border|ring|shadow|opacity|z|top|left|right|bottom|inset|overflow|truncate|line|whitespace|break|underline|decoration|uppercase|lowercase|transition|duration|ease|animate|cursor|select|block|inline|hidden|sr)(-|$)/;
// 사이트가 댓글 자리에 띄우는 안내문 (사용자가 쓴 글이 아니다)
const NOTICE =
  /(삭제된\s?(댓글|글|게시물)|삭제되었습니다|작성자에\s?의해|관리자에\s?의해|블라인드\s?(처리|된)|차단\s?시스템|(자동\s?)?숨김\s?처리|비공개\s?(댓글|처리)|운영\s?(원칙|정책|규정)에\s?따라|신고(가)?\s?누적|규정\s?위반으로|클린봇)/;
const NOTICE_MAX = 90;
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
  "SVG", "PATH", "OPTION", "OPTGROUP", "SELECT", "TEXTAREA", "TD", "TH", "LABEL", "NAV", "HEADER", "FOOTER",
]);
// 본문이 들어 있을 수 없는 곳 (입력·선택 칸, 메뉴, 버튼 등)
const NOT_TEXT_CONTAINER =
  "select, textarea, button, nav, h1, h2, h3, h4, h5, h6, [role=heading], [role=button], [role=navigation], [role=menu], [role=menubar], [role=toolbar], [role=tablist], [contenteditable=''], [contenteditable=true]";
const NOT_TEXT_ANCESTOR =
  "a, button, [role=button], time, label, select, textarea, input, nav, header, footer, h1, h2, h3, h4, h5, h6, svg, script, style, noscript, .eml-view, .eml-pill";
// 본문 글의 일부로 치는 인라인 태그. 링크·버튼 안의 글은 메뉴나 제목일 가능성이 높아 세지 않는다.
const INLINE = new Set(["SPAN", "B", "I", "EM", "STRONG", "BR", "FONT", "U", "S", "MARK", "SMALL", "SUB", "SUP", "CODE", "WBR", "ABBR", "Q"]);
// 확장이 넣은 요소와, 순화본으로 대체되어 숨겨진 원문 요소
const OURS = ".eml-view, .eml-pill, [data-eml-hidden]";
// 댓글 하나만 있어 견줄 수 없을 때는 이보다 짧은 글을 본문으로 보지 않는다 (닉네임을 본문으로 잡지 않게).
const MIN_TEXT_ALONE = 6;
// 숫자·기호·공백을 뺀 글자 수
const letterCount = (text) => text.replace(/[\d\s\p{P}\p{S}]/gu, "").length;
// 작성 시각처럼 보이는 글 (예: "11. 12 12:26:59 삭제", "3시간 전")
const DATE_LIKE = /\d{1,2}:\d{2}|\d{4}[.\-/]\s?\d{1,2}|\d{1,2}[.\-/]\s?\d{1,2}|\d+\s?(초|분|시간|일|주|개월|년)\s?전/;
const DATE_ALL = new RegExp(DATE_LIKE.source, "g");
const MAX_TEXT = 3000;
// 목록에서 이 비율 이상의 댓글에 있어야 본문 자리 후보가 된다 (같은 클래스를 쓰는 다른 줄이 섞여 있어도 되게 낮게 둔다).
const MIN_COVERAGE = 0.25;
// 본문 자리라면 댓글 하나에 평균 이만큼은 글자가 있다 (닉네임만 있는 자리를 본문으로 고르지 않게).
const MIN_AVG_LETTERS = 3;
// 목록 위로 이만큼 올라가며 "댓글·리뷰" 같은 이름을 찾는다.
const HINT_DEPTH = 6;

// Tailwind 를 접두어와 함께 쓰는 사이트(쿠팡 "twc-flex" 등)의 접두어. 페이지마다 findComments 에서 정한다.
let utilityPrefix = null;
let prefixCheckedAt = -Infinity;
const UTILITY_PROBE = /^([a-z][a-z0-9]{0,5})-(flex|grid|block|inline-flex|hidden|relative|absolute|items-center|justify-between|w-full|h-full)$/;

/** 페이지에서 "접두어-flex", "접두어-items-center" 같은 클래스가 여러 번 쓰였으면 그 접두어를 모양용 접두어로 본다. */
function findUtilityPrefix() {
  const counts = new Map();
  let scanned = 0;
  for (const el of document.body.querySelectorAll("[class]")) {
    if (++scanned > 4000) break;
    for (const cls of classTokens(el)) {
      const m = UTILITY_PROBE.exec(cls);
      if (!m) continue;
      const entry = counts.get(m[1]) ?? { n: 0, kinds: new Set() };
      entry.n++;
      entry.kinds.add(m[2]);
      counts.set(m[1], entry);
    }
  }
  const prefixes = [...counts].filter(([, e]) => e.n >= 10 && e.kinds.size >= 3).map(([p]) => p);
  return prefixes.length ? new RegExp(`^(?:${prefixes.join("|")})-`) : null;
}

// 접두어는 한 페이지에서 바뀌지 않으므로 찾으면 계속 쓰고, 못 찾았으면 글이 더 불러와진 뒤에 다시 본다.
function refreshUtilityPrefix() {
  if (utilityPrefix || performance.now() - prefixCheckedAt < 5000) return;
  prefixCheckedAt = performance.now();
  utilityPrefix = findUtilityPrefix();
}

/** 글자 크기·색·배치처럼 모양만 정하는 클래스인지. */
const isUtility = (cls) => UTILITY_CLASS.test(cls) || (!!utilityPrefix && utilityPrefix.test(cls) && UTILITY_CLASS.test(cls.replace(utilityPrefix, "")));

const classTokens = (el) => (typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean) : []);
// 이름으로 쓸 만한 클래스 (모양용 클래스·자동 생성된 번호 클래스를 뺀 것)
const nameTokens = (el) => classTokens(el).filter((cls) => !isUtility(cls) && !/\d{3,}/.test(cls));
// 같은 모양의 항목을 묶을 때 쓰는 클래스: 모양용이 아닌 첫 클래스 (자동 생성된 클래스도 페이지 안에서는 같은 모양을 뜻한다)
const shapeClass = (el) => classTokens(el).find((cls) => !isUtility(cls)) ?? "";

const hintOf = (el) =>
  HINT.test(el.tagName) ||
  HINT.test(typeof el.className === "string" ? el.className : "") ||
  HINT.test(el.id || "") ||
  HINT.test(el.getAttribute("aria-label") || "");

function hintedNearby(el) {
  for (let cur = el, depth = 0; cur && cur !== document.documentElement && depth < HINT_DEPTH; cur = cur.parentElement, depth++) {
    if (hintOf(cur)) return true;
  }
  return false;
}

/** 이름(클래스·id)으로 본문임이 드러나는지. 모양만 정하는 클래스는 보지 않는다. */
function isTextNamed(el) {
  if (TEXT_HINT.test(el.id || "")) return true;
  return classTokens(el).some((cls) => !isUtility(cls) && TEXT_HINT.test(cls));
}

/** 이름으로 본문이 아닌 칸(작성자·날짜·버튼 등)임이 드러나는지. */
function isNotTextNamed(el) {
  if (isTextNamed(el)) return false;
  const names = [...classTokens(el).filter((cls) => !isUtility(cls)), el.id || ""];
  // "comment-head", "date_time", "userName" 을 낱말로 쪼갠다.
  return names.some((name) =>
    name.split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).some((token) => NOT_TEXT_TOKENS.has(token.toLowerCase())),
  );
}

// 모양용 클래스만 있는 항목(Tailwind)은 클래스 전체가 같아야 같은 모양이다. 한 부품으로 그린 목록은 클래스가 똑같고,
// 옆에 놓인 다른 칸들은 클래스가 서로 다르다.
// 끝 번호만 다른 클래스("best01", "best02")는 같은 부품의 순번이므로 같은 모양으로 본다.
const keyOf = (el) => {
  const cls = shapeClass(el).replace(/[-_]?\d+$/, "");
  if (cls) return `${el.tagName}|${cls}`;
  const all = classTokens(el).sort().join(" ");
  return all ? `${el.tagName}|~${all}` : `${el.tagName}|`;
};

// 항목 안에서의 자리: 항목부터 그 요소까지 태그와 첫 클래스를 이은 경로.
function pathFrom(item, el) {
  const parts = [];
  for (let cur = el; cur && cur !== item; cur = cur.parentElement) {
    // 이름 있는 클래스가 없으면 모양 클래스 전체로 자리를 구별한다 (Tailwind 에서 닉네임 칸과 본문 칸이 같은 자리로 보이지 않게).
    const cls = nameTokens(cur)[0] ?? (classTokens(cur).length ? `~${classTokens(cur).sort().join(" ")}` : "");
    parts.push(`${cur.tagName}.${cls}`);
  }
  return parts.reverse().join(">");
}

// 요소 자신이 직접 가진 글 (블록 자식, 링크, 버튼 안의 글은 제외)
function ownText(el) {
  let out = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    else if (node.nodeType === Node.ELEMENT_NODE && INLINE.has(node.tagName.toUpperCase()) && !node.matches(NOT_TEXT_ANCESTOR)) out += ownText(node);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** 항목 안의 글 조각들. 중첩된 다른 항목(답글)과 링크·버튼·머리말 안의 글은 건너뛴다. */
function pieces(item, itemSet) {
  const out = [];
  const walker = document.createTreeWalker(item, NodeFilter.SHOW_ELEMENT, {
    acceptNode(el) {
      if (el !== item && itemSet.has(el)) return NodeFilter.FILTER_REJECT;
      // 사이트가 숨겨 둔 칸(차단된 원문, 접힌 메뉴)은 읽지 않는다.
      if (el !== item && el.style?.display === "none") return NodeFilter.FILTER_REJECT;
      if (el.matches(NOT_TEXT_ANCESTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    const text = ownText(el);
    if (!text || text.length > MAX_TEXT) continue;
    // 작성 시각("15시간 전", "11.13 11:02")은 글자 수에 넣지 않는다.
    const letters = letterCount(text.replace(DATE_ALL, " "));
    if (!letters) continue;
    out.push({ el, text, letters, path: el === item ? "" : pathFrom(item, el) });
  }
  return out;
}

/** 자리마다 본문다운 정도를 매긴다. 높을수록 본문이다. */
function scorePath(path, entries, itemCount) {
  const coverage = entries.length / itemCount;
  const letters = entries.reduce((sum, e) => sum + e.letters, 0) / entries.length;
  const distinct = new Set(entries.map((e) => e.text)).size / entries.length;
  const sample = entries[0].el;
  let score = letters * coverage * (itemCount > 2 ? distinct : 1);
  if (isTextNamed(sample)) score *= 1.6;
  // 경로 위쪽(항목 머리말 등)에 본문이 아니라는 이름이 붙어 있어도 깎는다.
  let notNamed = false;
  for (let cur = sample; cur && cur !== entries[0].item; cur = cur.parentElement) {
    if (isTextNamed(cur)) break;
    if (isNotTextNamed(cur)) {
      notNamed = true;
      break;
    }
  }
  if (notNamed) score *= 0.15;
  const dateLike = entries.filter((e) => DATE_LIKE.test(e.text) && e.letters < 8).length / entries.length;
  if (dateLike > 0.5) score *= 0.1;
  if (entries.filter((e) => HANGUL.test(e.text)).length < entries.length / 2) score *= 0.5;
  return { path, score, coverage, letters };
}

/** 같은 모양의 항목들에서 본문 자리를 함께 정해, 항목마다 본문 요소를 돌려준다. */
function chooseTextEls(items, itemSet) {
  const byPath = new Map();
  const perItem = items.map((item) => {
    const list = pieces(item, itemSet);
    // 같은 항목에서 같은 자리가 여러 번 나오면(문단 여러 개) 한 번으로 친다.
    const seen = new Map();
    for (const p of list) {
      const known = seen.get(p.path);
      if (known) {
        known.letters += p.letters;
        known.text += ` ${p.text}`;
        known.els.push(p.el);
      } else seen.set(p.path, { ...p, item, els: [p.el] });
    }
    for (const [path, entry] of seen) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(entry);
    }
    return seen;
  });

  let best = null;
  if (items.length >= 2) {
    for (const [path, entries] of byPath) {
      const scored = scorePath(path, entries, items.length);
      if (scored.coverage < MIN_COVERAGE || scored.letters < MIN_AVG_LETTERS) continue;
      if (!best || scored.score > best.score) best = scored;
    }
  }

  // 고른 자리 안쪽에 글이 거의 같은 자리가 있으면 그쪽이 본문이다 (바깥 자리에는 시각·번호 같은 군더더기가 붙어 있다).
  if (best) {
    for (const [path, entries] of byPath) {
      if (path === best.path || !(best.path === "" || path.startsWith(`${best.path}>`))) continue;
      const scored = scorePath(path, entries, items.length);
      if (scored.coverage >= best.coverage * 0.9 && scored.score >= best.score * 0.8 && path.length > best.path.length) best = { ...scored, score: Math.max(scored.score, best.score) };
    }
  }

  // 어떤 댓글에서 본문 자리가 여러 문단으로 나뉘어 있으면, 모든 댓글에서 그 문단들을 감싼 칸을 본문으로 맞춘다.
  let lift = 0;
  if (best) {
    for (const entries of [byPath.get(best.path)]) {
      for (const entry of entries) {
        if (entry.els.length < 2) continue;
        const parent = commonParent(entry.els, entry.item, itemSet);
        let depth = 0;
        for (let cur = entry.els[0]; cur && cur !== parent; cur = cur.parentElement) depth++;
        if (parent.contains(entry.els[0]) && parent !== entry.els[0]) lift = Math.max(lift, depth);
      }
    }
  }

  return items.map((item, index) => {
    const entry = best && perItem[index].get(best.path);
    if (!entry) return pickAlone(perItem[index], item, itemSet);
    if (entry.els.length > 1) return commonParent(entry.els, item, itemSet);
    let el = entry.els[0];
    for (let i = 0; i < lift && el.parentElement && el.parentElement !== item && !holdsItems(el.parentElement, itemSet); i++) el = el.parentElement;
    return el;
  });
}

// 다른 댓글 항목을 품고 있는 요소는 본문이 될 수 없다 (답글 묶음 전체를 본문으로 잡지 않게).
const holdsItems = (el, itemSet) => [...el.querySelectorAll("*")].some((child) => itemSet.has(child));

// 문단 여러 개로 나뉜 본문은 그 문단들을 감싼 요소를 본문으로 본다.
function commonParent(els, item, itemSet) {
  let parent = els[0].parentElement;
  while (parent && parent !== item && !els.every((el) => parent.contains(el))) parent = parent.parentElement;
  if (parent && parent !== item && !holdsItems(parent, itemSet)) return parent;
  return els.reduce((a, b) => (letterCount(b.textContent) > letterCount(a.textContent) ? b : a));
}

// 견줄 다른 항목이 없거나 본문 자리에 글이 없는 항목: 이 항목 안에서만 고른다.
function pickAlone(entries, item, itemSet) {
  let best = null;
  let bestScore = 0;
  for (const entry of entries.values()) {
    // 같은 자리가 여러 번 나온 경우 실제로 돌려줄 요소 하나의 글로 판단한다.
    const el = entry.els.length === 1 ? entry.els[0] : commonParent(entry.els, item, itemSet);
    const text = entry.els.includes(el) && entry.els.length > 1 ? ownText(el) : entry.text;
    const letters = letterCount(text.replace(DATE_ALL, " "));
    if (text.length < MIN_TEXT_ALONE && !isTextNamed(el)) continue;
    if (letters < MIN_AVG_LETTERS) continue;
    const { score } = scorePath(entry.path, [{ ...entry, el, text, letters, item }], 1);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

const listIds = new WeakMap();
let nextListId = 0;
const listId = (el) => {
  if (!listIds.has(el)) listIds.set(el, ++nextListId);
  return listIds.get(el);
};

/** 요소들을 모두 품는 가장 안쪽 조상. */
function commonAncestor(els) {
  let anc = els[0]?.parentElement ?? null;
  while (anc && !els.every((el) => anc.contains(el))) anc = anc.parentElement;
  return anc;
}

/** 반복되는 댓글 목록을 찾아, 같은 모양(태그·클래스)의 항목끼리 묶어 돌려준다. */
function findGroupsAuto() {
  const groups = new Map();
  const add = (key, el) => {
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(el);
  };
  for (const parent of document.body.querySelectorAll("*")) {
    if (parent.childElementCount < 2 || parent.closest(".eml-view, .eml-pill")) continue;
    const siblings = new Map();
    for (const child of parent.children) {
      if (NOT_ITEM.has(child.tagName.toUpperCase()) || child.matches(OURS)) continue;
      const key = keyOf(child);
      if (!siblings.has(key)) siblings.set(key, []);
      siblings.get(key).push(child);
    }
    for (const [shape, members] of siblings) {
      if (members.length < 2) continue;
      // 클래스가 없는 항목(li 등)은 모양만으로는 다른 목록과 구별되지 않으므로 목록마다 따로 묶는다.
      const key = shapeClass(members[0]) ? shape : `${shape}@${listId(parent)}`;
      // 대부분 글이 들어 있는 반복 블록이어야 댓글 목록으로 본다. 그중 한글이 있는 것만 처리 대상이다
      // (영어 댓글이 섞여 있거나 일부가 비어 있어도 목록 전체를 버리지 않는다).
      const filled = members.filter((m) => m.textContent.trim());
      if (filled.length < 2 || filled.length < members.length * 0.6) continue;
      const withText = filled.filter((m) => HANGUL.test(m.textContent));
      if (!withText.length) continue;
      const hintedMembers = members.filter(hintOf).length;
      if (!hintedNearby(parent) && hintedMembers < members.length * 0.6) continue;
      for (const m of withText) add(key, m);
    }
  }
  // 답글이 하나뿐인 목록처럼 반복되지 않아 놓친 같은 모양의 항목도 같은 묶음에 넣는다.
  // 단, 그 목록이 차지한 영역 안에서만 찾는다 (같은 클래스를 쓰는 상품 정보·메뉴까지 끌어오지 않게).
  for (const [key, members] of groups) {
    const first = members.values().next().value;
    const cls = shapeClass(first);
    if (!cls) continue;
    const region = commonAncestor([...members]);
    if (!region || region === document.body || region === document.documentElement) continue;
    const selector = `${first.tagName.toLowerCase()}.${CSS.escape(cls)}`;
    for (const el of region.querySelectorAll(selector)) {
      if (!members.has(el) && !el.matches(OURS) && !el.closest(".eml-view, .eml-pill") && HANGUL.test(el.textContent)) members.add(el);
    }
    groups.set(key, members);
  }
  return [...groups.values()].map((set) => [...set]);
}

/**
 * 다른 목록의 항목 안에 하나씩 들어 있는 "부품"을 목록으로 잘못 본 묶음을 버린다.
 * 예: 네이트는 차단된 댓글에 본문 칸이 둘(숨긴 원문, 안내문)이라 본문 칸끼리 반복 목록처럼 보인다.
 * 이런 묶음은 바깥 댓글 항목 안에 들어 있고, 항목마다 본문 글 한 조각만 담고 있다.
 * 답글처럼 닉네임·시각을 따로 가진 안쪽 항목은 그 자체가 댓글이므로 남는다.
 */
function dropPartGroups(groups) {
  const owner = new Map();
  groups.forEach((group, index) => group.forEach((el) => owner.set(el, index)));
  return groups.filter((group, index) => {
    const outers = new Map();
    let outerGroup = null;
    for (const el of group) {
      let outer = el.parentElement;
      while (outer && !(owner.has(outer) && owner.get(outer) !== index)) outer = outer.parentElement;
      if (!outer) continue;
      if (outerGroup !== null && owner.get(outer) !== outerGroup) return true;
      outerGroup = owner.get(outer);
      outers.set(outer, (outers.get(outer) ?? 0) + 1);
    }
    if (outerGroup === null) return true;
    const inside = [...outers.values()].reduce((a, b) => a + b, 0);
    if (inside < group.length * 0.9) return true;
    // 댓글 항목이라면 본문 말고도 닉네임·시각 같은 글이 함께 있다. 글 조각이 하나뿐인 칸은 본문 칸(부품)이다.
    const bare = group.filter((el) => pieces(el, new Set()).length <= 1).length;
    return bare < group.length * 0.8;
  });
}

// 글이 있는 항목이 두 개뿐인 묶음은 반복만으로는 댓글 목록이라는 증거가 약하다 (리뷰 요약표, 안내 상자 등).
// 이런 묶음은 본문 밖에 작성 시각이 붙어 있거나, 항목 이름이 댓글·리뷰이고 두 항목의 본문 자리가 같을 때만 댓글로 본다.
const SMALL_GROUP = 2;
function looksLikeComments(items, textEls) {
  const found = items.map((item, i) => [item, textEls[i]]).filter(([, textEl]) => textEl);
  // 목록이라면 글이 있는 항목이 둘 이상이다 (메뉴·도구 줄은 글이 있는 칸이 하나뿐인 경우가 많다).
  if (found.length < 2) return false;
  if (found.length > SMALL_GROUP) return true;
  if (found.some(([item, textEl]) => DATE_LIKE.test((item.textContent ?? "").replace(textEl.textContent ?? "", " ")))) return true;
  const paths = new Set(found.map(([item, textEl]) => pathFrom(item, textEl)));
  return paths.size === 1 && found.every(([item]) => hintOf(item));
}

/** 사이트가 띄운 안내문인지 (삭제·숨김·차단된 댓글 자리). */
export function isNotice(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= NOTICE_MAX && NOTICE.test(t);
}

/** 이 사이트에 정해 둔 댓글 본문 위치 (페이지를 읽기 시작하자마자 흐리게 할 때 쓴다). */
export function siteTextSelectors() {
  const rule = SITE_RULES[location.hostname];
  if (!rule || rule.skipPath?.test(location.pathname)) return [];
  return rule.item.split(",").map((item) => `${item.trim()} ${rule.text}`);
}

/**
 * @param {string|null} customSelector 사용자가 직접 지정한 댓글 항목 선택자
 * @returns {{item: Element, textEl: Element}[]}
 */
export function findComments(customSelector) {
  refreshUtilityPrefix();
  let groups = [];
  if (customSelector) {
    try {
      const items = [...document.querySelectorAll(customSelector)];
      if (items.length) groups = [items];
    } catch {
      groups = [];
    }
  }
  if (!groups.length) {
    const rule = SITE_RULES[location.hostname];
    if (rule && !rule.skipPath?.test(location.pathname)) {
      const out = [];
      for (const item of document.querySelectorAll(rule.item)) {
        const textEl = item.querySelector(rule.text);
        if (textEl && !textEl.closest(OURS)) out.push({ item, textEl });
      }
      return out;
    }
    groups = findGroupsAuto();
  }

  if (!customSelector) groups = dropPartGroups(groups);
  const itemSet = new Set(groups.flat());
  const seen = new Set();
  const out = [];
  for (const items of groups) {
    const textEls = chooseTextEls(items, itemSet);
    if (!customSelector && !looksLikeComments(items, textEls)) continue;
    items.forEach((item, index) => {
      const textEl = textEls[index];
      if (!textEl || seen.has(textEl) || textEl.closest(OURS) || textEl.closest(NOT_TEXT_CONTAINER)) return;
      seen.add(textEl);
      if (isNotice(textEl.textContent ?? "")) return;
      out.push({ item, textEl });
    });
  }
  return out;
}

// 사용자가 클릭한 요소에서 댓글 항목 선택자를 추정한다.
export function selectorFromClick(target) {
  refreshUtilityPrefix();
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
  const part = (el) => el.tagName.toLowerCase() + (shapeClass(el) ? `.${CSS.escape(shapeClass(el))}` : "");
  return `${part(best.parentElement)} > ${part(best)}`;
}
