// 콘텐츠 스크립트: 댓글을 찾아 두고, 화면에 보이는(곧 보일) 댓글만 분류해 표시한다.
// 설정이 바뀌면 새로 고침 없이 바로 반영한다.
import { findComments } from "./detect.js";
import {
  renderComment,
  removeView,
  hideComment,
  renderPill,
  renderStaleNotice,
  measure,
  syncTypography,
  fixInPlace,
} from "./render.js";
import { startPicker, stopPicker } from "./picker.js";
import { openEmotionPicker, openWordMenu, openShareNotice, closePopover } from "./feedback.js";
import { GROUPS } from "../shared/emotion.js";
import { isUnchanged, hasProfanity } from "../shared/strip.js";
import { cleanText } from "../shared/clean.js";
import { DEFAULTS, STORAGE_KEYS, DATA_KEYS, normalize, normalizeData } from "../shared/settings.js";
import { learnedGroup, addFix, textKey, OWN_WEIGHT, SHARED_WEIGHT } from "../shared/learn.js";

const BATCH = 8;
const MAX_CHARS = 300;
// 화면 위아래로 이만큼 떨어진 댓글까지 미리 처리해, 스크롤했을 때 원문이 보이지 않게 한다.
const PRELOAD_MARGIN = "400px 0px 800px 0px";
const PENDING_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 3000;
const HANGUL = /[가-힣]/;

const isTop = window === window.top;
// 댓글 위치는 댓글이 실제로 있는 문서(프레임)의 주소로 기억한다.
const host = location.hostname;
// 사이트별 켜기/끄기는 사용자가 보고 있는 탭의 주소를 따른다.
const siteHost = (() => {
  if (isTop) return host;
  try {
    const origins = location.ancestorOrigins;
    if (origins?.length) return new URL(origins[origins.length - 1]).hostname;
  } catch {}
  return host;
})();

let settings = { ...DEFAULTS };
let running = false;
// textEl -> { item, original, raw, group, v, cleaned, view, goneEl, state: "waiting" | "queued" | "done" }
// v: 모델 점수, cleaned: 순화본 글, view: 순화본 요소 (원문 요소를 그대로 꾸민 경우 null),
// goneEl: 아예 숨긴 경우 숨겨진 요소
const tracked = new Map();
const queue = [];
// 같은 글을 다시 분류하지 않도록 모델의 결과를 기억한다 (설정을 바꿔 다시 그릴 때, 사이트가 요소를 재사용할 때).
// 값: { group: 규칙으로 정한 감정, v: 44개 점수 }
const groupCache = new Map();

// ── 사용자가 고쳐 준 내용 ────────────────────────────────────────────────
// 내가 고친 판정과 표현은 바로 적용하고, 서버에서 받은 공유 묶음(여러 사람이 같은 의견을 낸 것)도 함께 쓴다.
let data = normalizeData();
let fixByKey = new Map();
let examples = [];
let words = { remove: [], keep: [] };

function rebuildLearned() {
  fixByKey = new Map(data.myFixes.map((fix) => [fix.t, fix.g]));
  examples = [
    ...data.myFixes.filter((fix) => Array.isArray(fix.v)).map((fix) => ({ v: fix.v, g: fix.g, w: OWN_WEIGHT })),
    ...data.shared.examples.map((example) => ({ v: example.v, g: example.g, w: SHARED_WEIGHT })),
  ];
  // 내가 정한 것이 공유 묶음보다 우선한다.
  const mine = data.myWords;
  words = {
    remove: [...new Set([...mine.remove, ...data.shared.remove.filter((p) => !mine.keep.includes(p))])],
    keep: [...new Set([...mine.keep, ...data.shared.keep.filter((p) => !mine.remove.includes(p))])],
  };
}

// 이 댓글의 감정을 정한다: 내가 직접 고친 글 → 고친 사례와 점수가 가까운 글 → 모델과 규칙
function decideGroup(original, result) {
  const own = fixByKey.get(textKey(original));
  if (own) return own;
  const learned = learnedGroup(result.v, examples);
  if (learned) return learned;
  // 욕설이 있는데 모델이 중립으로 본 댓글은 분노로 표시한다.
  return result.group === "neutral" && hasProfanity(original) ? "anger" : result.group;
}
let scanTimer = null;
let themeTimer = null;
let pumping = false;
let visibility = null;
let domObserver = null;
let themeObserver = null;
let observedBody = null;
let countTimer = null;

const isActive = () => settings.enabled && !settings.disabledHosts.includes(siteHost);
const rawText = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const readText = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

function requestGroups(texts) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "classify", texts }, (res) => {
        if (chrome.runtime.lastError || !res || res.error) {
          console.warn("[emotionless] 분류 실패:", chrome.runtime.lastError?.message ?? res?.error);
          resolve(null);
        } else resolve(res.results);
      });
    } catch (err) {
      console.warn("[emotionless] 분류 요청 실패:", err);
      resolve(null);
    }
  });
}

async function classify(texts) {
  const missing = [...new Set(texts.filter((text) => !groupCache.has(text)))];
  if (missing.length) {
    const results = await requestGroups(missing);
    if (!results) return null;
    missing.forEach((text, index) => groupCache.set(text, results[index]));
    // 오래된 것부터 덜어 낸다.
    for (const key of groupCache.keys()) {
      if (groupCache.size <= CACHE_LIMIT) break;
      groupCache.delete(key);
    }
  }
  return texts.map((text) => groupCache.get(text));
}

// ── 반응 요약 ────────────────────────────────────────────────────────────
// 감정별 댓글 수는 화면 구석에 떠 있는 요약 하나에 모은다. 페이지 흐름 밖에 있어 댓글을 밀어내지 않는다.
// 프레임 안의 댓글 수와 직접 지정 여부는 맨 위 페이지로 보내 합친다.
const COUNT_MSG = "__emotionless_counts";
const frameInfo = new Map();

// 화면에 그려져 있는지. 사이트가 이전 화면을 지우지 않고 숨겨만 두는 경우를 가려낸다.
const isRendered = (el) => el.isConnected && (el.offsetParent !== null || el.getClientRects().length > 0);

// 지금 페이지에 실제로 보이는 댓글만 센다. 다른 화면으로 넘어가 숨겨진 댓글은 세지 않는다.
function localCounts() {
  const counts = {};
  for (const [textEl, entry] of tracked) {
    if (!entry.group) continue;
    // 우리가 숨긴 댓글은 그 자리가 화면에 있는지로 판단한다.
    const where = entry.goneEl ? (entry.goneEl === textEl ? entry.item : entry.goneEl.parentElement) : entry.view ?? textEl;
    if (where && isRendered(where)) counts[entry.group] = (counts[entry.group] ?? 0) + 1;
  }
  return counts;
}

function totalCounts() {
  const total = localCounts();
  const frames = new Set([...document.querySelectorAll("iframe")].map((f) => f.contentWindow));
  for (const [source, { counts }] of frameInfo) {
    // 사라진 프레임의 숫자는 버린다.
    if (!frames.has(source)) {
      frameInfo.delete(source);
      continue;
    }
    for (const [group, count] of Object.entries(counts)) total[group] = (total[group] ?? 0) + count;
  }
  return total;
}

function showPill() {
  const visible = isActive() && settings.showPill;
  renderPill(visible ? totalCounts() : {}, settings.pillCollapsed, () => {
    settings.pillCollapsed = !settings.pillCollapsed;
    try {
      chrome.storage.local.set({ pillCollapsed: settings.pillCollapsed });
    } catch {}
    showPill();
  });
}

let lastPosted = "";

function publishCounts() {
  if (isTop) showPill();
  else {
    const message = { type: COUNT_MSG, counts: localCounts(), customHost: settings.selectors[host] ? host : null };
    // 달라진 것이 없으면 보내지 않는다.
    const signature = JSON.stringify(message);
    if (signature === lastPosted) return;
    lastPosted = signature;
    window.top.postMessage(message, "*");
  }
}

function onFrameCounts(event) {
  if (event.data?.type !== COUNT_MSG || !event.source || typeof event.data.counts !== "object") return;
  const counts = {};
  for (const group of Object.keys(GROUPS)) {
    const count = event.data.counts?.[group];
    if (Number.isInteger(count) && count > 0 && count < 100000) counts[group] = count;
  }
  const customHost = typeof event.data.customHost === "string" ? event.data.customHost.slice(0, 255) : null;
  frameInfo.set(event.source, { counts, customHost });
  showPill();
}

// 팝업이 물어볼 때 알려 주는 현재 페이지의 상태
function pageStatus() {
  const customHosts = new Set();
  if (settings.selectors[host]) customHosts.add(host);
  for (const { customHost } of frameInfo.values()) if (customHost) customHosts.add(customHost);
  return { host: siteHost, active: isActive(), counts: isActive() ? totalCounts() : {}, customHosts: [...customHosts] };
}

// ── 프레임 높이 ──────────────────────────────────────────────────────────
// 댓글이 높이가 고정된 프레임 안에 있으면, 순화본 때문에 늘어난 높이만큼 프레임이 잘린다.
// 프레임 안쪽에서 필요한 높이를 알리고, 바깥쪽에서 그 프레임을 키운다.
const FRAME_MSG = "__emotionless_frame_height";
let reportedHeight = 0;

function reportFrameHeight() {
  if (isTop) return;
  requestAnimationFrame(() => {
    const height = Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
    if (height === reportedHeight) return;
    reportedHeight = height;
    window.parent.postMessage({ type: FRAME_MSG, height }, "*");
  });
}

function growChildFrame(event) {
  const height = event.data?.type === FRAME_MSG ? event.data.height : null;
  if (typeof height !== "number" || !Number.isFinite(height)) return;
  const frame = [...document.querySelectorAll("iframe")].find((f) => f.contentWindow === event.source);
  if (!frame) return;
  const current = frame.getBoundingClientRect().height;
  // 늘리기만 하고, 한 번에 지나치게 커지지 않게 막는다.
  if (height > current + 1 && height < current + 20000) frame.style.setProperty("height", `${height}px`, "important");
}

// ── 댓글 처리 ────────────────────────────────────────────────────────────
function forget(textEl, entry) {
  visibility?.unobserve(textEl);
  entry.goneEl?.removeAttribute("data-eml-gone");
  removeView(textEl, entry.view);
  tracked.delete(textEl);
}

function forgetAll() {
  for (const [textEl, entry] of tracked) forget(textEl, entry);
  queue.length = 0;
}

// 분류를 못 하게 되면 페이지를 원래대로 돌려놓는다. 흐리게 해 둔 댓글이 그대로 남으면 읽을 수 없기 때문이다.
// 확장이 업데이트되어 이 페이지와의 연결이 끊긴 경우에는 새로 고칠 때까지 쉰다. 그 밖에는 조금 뒤에 다시 시도한다.
const MAX_RETRIES = 3;
let failures = 0;

function contextAlive() {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

// 확장이 업데이트되면 이미 열려 있던 페이지의 이 스크립트는 확장과 연결이 끊긴다.
// 페이지를 원래대로 돌려놓고, 댓글을 처리하던 페이지였다면 새로 고치라고 알린다.
const STALE_MSG = "__emotionless_stale";

function handleDisconnected() {
  const wasWorking = tracked.size > 0;
  stop();
  if (!wasWorking) return;
  if (isTop) renderStaleNotice();
  else window.top.postMessage({ type: STALE_MSG }, "*");
}

function handleFailure() {
  if (!contextAlive()) {
    handleDisconnected();
    return;
  }
  failures++;
  stop();
  if (failures > MAX_RETRIES) return;
  setTimeout(() => {
    if (contextAlive() && isActive()) start();
  }, 5000 * failures);
}

// 대기열을 비운다. 가장 최근에 화면에 들어온 댓글부터 처리한다.
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const batch = queue
        .splice(-BATCH)
        .reverse()
        .filter((textEl) => textEl.isConnected && tracked.get(textEl)?.state === "queued");
      if (!batch.length) continue;
      const groups = await classify(batch.map((textEl) => tracked.get(textEl).original.slice(0, MAX_CHARS)));
      // 기다리는 동안 꺼졌으면 아무것도 그리지 않는다.
      if (!running) break;
      if (!groups) {
        handleFailure();
        break;
      }
      failures = 0;
      // 읽기를 먼저 끝내고 쓰기를 몰아서 한다.
      const metrics = batch.map((textEl) => {
        const entry = tracked.get(textEl);
        return entry && textEl.isConnected ? measure(textEl, entry.item) : null;
      });
      const inPlace = [];
      batch.forEach((textEl, index) => {
        const entry = tracked.get(textEl);
        textEl.removeAttribute("data-eml-pending");
        if (!entry || entry.state === "done") return;
        if (!metrics[index]) {
          forget(textEl, entry);
          return;
        }
        entry.v = groups[index].v;
        entry.group = decideGroup(entry.original, groups[index]);
        entry.state = "done";
        visibility.unobserve(textEl);
        const level = settings.level;
        if (level === "hide" && GROUPS[entry.group].fold) {
          const hasReplies = [...tracked.values()].some((other) => other.item !== entry.item && entry.item.contains(other.item));
          entry.goneEl = hideComment(textEl, entry.item, hasReplies);
          return;
        }
        // "표시만" 단계에서는 글을 건드리지 않는다.
        // 모델이 고른 지울 부분으로 순화한다. 사용자가 알려 준 표현과 늘 지우는 것(욕설 등)도 함께 반영한다.
        const cleaned = level === "label" ? entry.original : cleanText(entry.original, groups[index].del ?? [], words);
        entry.cleaned = cleaned;
        const data = {
          group: entry.group,
          original: entry.original,
          cleaned,
          changed: level !== "label" && !isUnchanged(entry.original, cleaned),
        };
        const display = { fold: level === "fold" };
        entry.view = renderComment(textEl, data, display, metrics[index]);
        if (!entry.view) {
          inPlace.push({
            textEl,
            item: entry.item,
            before: metrics[index],
            fallback: () => {
              removeView(textEl, null);
              entry.view = renderComment(textEl, data, display, metrics[index], { forceView: true });
            },
          });
        }
      });
      fixInPlace(inPlace);
      publishCounts();
      reportFrameHeight();
    }
  } finally {
    pumping = false;
  }
}

function onVisible(entries) {
  for (const { target, isIntersecting } of entries) {
    const entry = tracked.get(target);
    if (!isIntersecting || !entry || entry.state !== "waiting") continue;
    entry.state = "queued";
    visibility.unobserve(target);
    queue.push(target);
    setTimeout(() => target.removeAttribute("data-eml-pending"), PENDING_TIMEOUT_MS);
  }
  pump();
}

function track(item, textEl) {
  const original = readText(textEl);
  if (!original || !HANGUL.test(original)) return false;
  tracked.set(textEl, { item, original, raw: rawText(textEl), group: null, view: null, state: "waiting" });
  // 처리 전 원문이 읽히지 않도록 흐리게 해 둔다.
  textEl.setAttribute("data-eml-pending", "");
  visibility.observe(textEl);
  return true;
}

// 댓글 하나만 다시 그린다 (감정을 고쳤을 때). 펼쳐 둔 다른 댓글은 건드리지 않는다.
function refreshEntry(textEl) {
  const entry = tracked.get(textEl);
  if (!entry) return;
  const { item } = entry;
  forget(textEl, entry);
  if (!track(item, textEl)) return;
  visibility.unobserve(textEl);
  tracked.get(textEl).state = "queued";
  queue.push(textEl);
  pump();
}

function scan() {
  if (!running) return;
  if (!contextAlive()) {
    handleDisconnected();
    return;
  }
  // 사라졌거나 내용이 바뀐 댓글 정리 (사이트가 요소를 재사용하는 경우)
  for (const [textEl, entry] of tracked) {
    const stale = !textEl.isConnected || rawText(textEl) !== entry.raw || (entry.view && !entry.view.isConnected);
    if (stale) forget(textEl, entry);
  }
  for (const { item, textEl } of findComments(settings.selectors[host] ?? null)) {
    // 숨겨진 화면에 남아 있는 댓글은 다시 보일 때 처리한다.
    if (tracked.has(textEl) || !isRendered(textEl)) continue;
    track(item, textEl);
  }
  // 댓글이 사라졌거나 다른 화면으로 넘어갔으면 숫자도 따라 바뀐다.
  publishCounts();
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 300);
}

// 사이트 테마가 바뀌면 순화본에 옮겨 둔 글자색을 다시 맞춘다.
function scheduleThemeSync() {
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => {
    const pairs = [];
    for (const [textEl, entry] of tracked) if (entry.view?.isConnected) pairs.push({ textEl, view: entry.view });
    if (pairs.length) syncTypography(pairs);
  }, 300);
}

// ── 판정 고치기 ──────────────────────────────────────────────────────────
// 얼굴을 누르면 감정을, 글을 드래그하면 표현을 고칠 수 있다. 고친 것은 이 기기에 바로 적용하고,
// 사용자가 동의했으면 서버에도 보내 모두의 판정을 개선하는 데 쓴다.
function share(payload, anchor) {
  const send = () => {
    try {
      chrome.runtime.sendMessage({ type: "feedback", payload });
    } catch {}
  };
  if (!__API_BASE__ || settings.shareFeedback === false) return;
  if (settings.shareNoticeSeen) {
    send();
    return;
  }
  // 보내기는 기본으로 켜져 있다. 처음 한 번은 보낸다는 것을 알리고, 그 자리에서 끌 수 있게 한다.
  // 안내를 확인하기 전에는 보내지 않는다.
  openShareNotice({
    x: anchor.x,
    y: anchor.y,
    onClose: (keepSharing) => {
      settings.shareNoticeSeen = true;
      settings.shareFeedback = keepSharing;
      chrome.storage.local.set({ shareNoticeSeen: true, shareFeedback: keepSharing }).then(() => keepSharing && send());
    },
  });
}

function fixEmotion(textEl, group, anchor) {
  const entry = tracked.get(textEl);
  if (!entry?.v) return;
  const key = textKey(entry.original);
  const predicted = entry.group;
  data.myFixes = addFix(data.myFixes, { t: key, v: entry.v, g: group, at: Date.now() });
  rebuildLearned();
  chrome.storage.local.set({ myFixes: data.myFixes });
  refreshEntry(textEl);
  share({ kind: "emotion", text: key, predicted, corrected: group, scores: entry.v }, anchor);
}

function fixWord(textEl, kind, phrase, anchor) {
  const entry = tracked.get(textEl);
  if (!entry) return;
  const other = kind === "remove" ? "keep" : "remove";
  const myWords = {
    [kind]: [...new Set([...data.myWords[kind], phrase])],
    [other]: data.myWords[other].filter((p) => p !== phrase),
  };
  // 저장하면 onSettingsChanged 가 불려 새 목록으로 다시 그린다.
  chrome.storage.local.set({ myWords });
  share({ kind, text: textKey(entry.original), phrase }, anchor);
}

// 누른 곳이 어느 댓글의 얼굴인지 찾는다. 원문 요소를 그대로 꾸민 댓글은 얼굴이 배경 그림이라 자리로 판단한다.
function faceTarget(event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  if (target.matches(".eml-msg > .eml-emoji")) {
    const textEl = target.closest(".eml-view")?.previousElementSibling;
    return textEl && tracked.has(textEl) ? textEl : null;
  }
  const inPlace = target.closest("[data-eml-inplace]");
  if (inPlace && tracked.has(inPlace) && !target.closest("a, button")) {
    const rect = inPlace.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(inPlace).backgroundSize) || 28;
    if (event.clientX - rect.left <= size + 4 && event.clientY - rect.top <= size + 12) return inPlace;
  }
  return null;
}

function onFaceClick(event) {
  if (!running) return;
  const textEl = faceTarget(event);
  if (!textEl) return;
  event.preventDefault();
  event.stopPropagation();
  const anchor = { x: event.clientX, y: event.clientY - 12 };
  openEmotionPicker({ ...anchor, current: tracked.get(textEl).group, onPick: (group) => fixEmotion(textEl, group, anchor) });
}

// 댓글 안의 글을 드래그해 고르면, 그 표현을 지울지 남길지 고르는 작은 메뉴를 띄운다.
function onSelection() {
  if (!running) return;
  const selection = getSelection();
  const phrase = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
  if (!selection || selection.isCollapsed || phrase.length < 1 || phrase.length > 40) return;
  const host = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest(".eml-view, [data-eml-inplace]");
  const where = host(selection.anchorNode);
  if (!where || where !== host(selection.focusNode)) return;
  const textEl = where.matches("[data-eml-inplace]") ? where : where.previousElementSibling;
  const entry = textEl && tracked.get(textEl);
  if (!entry || !entry.original.includes(phrase)) return;
  // 지금 순화본에 남아 있는 표현이면 "지우기", 원문에만 있는(이미 지워진) 표현이면 "남기기"를 권한다.
  const stillShown = (entry.cleaned ?? entry.original).includes(phrase);
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const anchor = { x: rect.left + rect.width / 2, y: rect.top };
  openWordMenu({
    ...anchor,
    actions: [stillShown ? { id: "remove", label: "이 표현 지우기" } : { id: "keep", label: "이 표현 남기기" }],
    onPick: (kind) => {
      selection.removeAllRanges();
      fixWord(textEl, kind, phrase, anchor);
    },
  });
}

// ── 켜기 / 끄기 ──────────────────────────────────────────────────────────
function start() {
  if (running) return;
  running = true;
  visibility = new IntersectionObserver(onVisible, { rootMargin: PRELOAD_MARGIN });
  domObserver = new MutationObserver((mutations) => {
    // 우리가 넣은 요소로 인한 변화는 무시한다.
    const external = mutations.some((m) => {
      const target = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      return target && !target.closest(".eml-view, .eml-pill, .eml-picker-banner");
    });
    if (external) scheduleScan();
  });
  // body 를 통째로 갈아 끼우는 사이트도 있으므로 문서 전체를 지켜본다.
  domObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  // 테마 전환은 보통 html 이나 body 의 속성을 바꾸거나, 시스템 설정을 따라간다.
  themeObserver = new MutationObserver(scheduleThemeSync);
  const themeAttributes = {
    attributes: true,
    attributeFilter: ["class", "style", "dark", "data-theme", "data-color-mode", "theme"],
  };
  themeObserver.observe(document.documentElement, themeAttributes);
  observedBody = document.body;
  themeObserver.observe(observedBody, themeAttributes);
  scan();
  publishCounts();
}

function stop() {
  if (!running) return;
  running = false;
  clearTimeout(scanTimer);
  clearTimeout(themeTimer);
  clearTimeout(countTimer);
  countTimer = null;
  domObserver.disconnect();
  themeObserver.disconnect();
  forgetAll();
  visibility.disconnect();
  stopPicker();
  closePopover();
  publishCounts();
}

// 표시 방식이 바뀌었을 때 처음부터 다시 그린다. 분류 결과는 기억하고 있어 바로 끝난다.
function rerender() {
  forgetAll();
  scan();
  publishCounts();
}

function onSettingsChanged(changes, area) {
  if (area !== "local") return;
  if (DATA_KEYS.some((key) => key in changes)) {
    const next = { ...data };
    for (const key of DATA_KEYS) if (key in changes) next[key] = changes[key].newValue;
    data = normalizeData(next);
    rebuildLearned();
    // 표현 목록이 바뀌면 지우는 결과가 달라지므로 다시 그린다. 판정을 고친 것은 그 댓글만 따로 다시 그린다.
    if (running && ("myWords" in changes || "shared" in changes)) rerender();
  }
  const wasActive = isActive();
  const previous = settings;
  const next = { ...settings };
  for (const key of Object.keys(DEFAULTS)) if (key in changes) next[key] = changes[key].newValue ?? DEFAULTS[key];
  settings = normalize(next);

  if (isActive() !== wasActive) {
    if (isActive()) start();
    else stop();
    return;
  }
  if (!running) return;
  const locationChanged = previous.selectors[host] !== settings.selectors[host];
  if (previous.level !== settings.level || locationChanged) rerender();
  else publishCounts();
}

function onMessage(msg, _sender, sendResponse) {
  if (msg?.type === "status") {
    // 탭 전체의 상태는 맨 위 페이지만 알고 있다.
    if (isTop) sendResponse(pageStatus());
    return false;
  }
  if (msg?.type === "pick" && running) {
    startPicker((selector) => {
      // 저장하면 onSettingsChanged 가 불려 새 위치로 다시 그린다.
      chrome.storage.local.set({ selectors: { ...settings.selectors, [host]: selector } });
    });
  } else if (msg?.type === "pick-stop") {
    stopPicker(msg.cancelled !== true);
  }
  return false;
}

async function main() {
  const stored = await chrome.storage.local.get([...STORAGE_KEYS, ...DATA_KEYS]);
  settings = normalize(stored);
  data = normalizeData(stored);
  rebuildLearned();
  // 공유 묶음을 가끔 새로 받아 온다 (맨 위 페이지에서 한 번만 부탁한다).
  if (isTop && __API_BASE__) {
    try {
      chrome.runtime.sendMessage({ type: "sync-shared" });
    } catch {}
  }

  chrome.storage.onChanged.addListener(onSettingsChanged);
  document.addEventListener("click", onFaceClick, true);
  document.addEventListener("mouseup", () => setTimeout(onSelection), true);
  chrome.runtime.onMessage.addListener(onMessage);
  window.addEventListener("message", growChildFrame);
  if (isTop) {
    window.addEventListener("message", onFrameCounts);
    window.addEventListener("message", (event) => {
      if (event.data?.type === STALE_MSG) renderStaleNotice();
    });
  }
  // 새로 고침 없이 화면만 바뀌는 사이트(유튜브 등)에서 페이지가 바뀌면 댓글과 숫자를 다시 살핀다.
  const onNavigated = () => {
    if (!running) return;
    // body 가 새것으로 바뀌었으면 테마 감시를 새 body 에 다시 건다.
    if (document.body && document.body !== observedBody) {
      observedBody = document.body;
      themeObserver.observe(observedBody, {
        attributes: true,
        attributeFilter: ["class", "style", "dark", "data-theme", "data-color-mode", "theme"],
      });
    }
    scheduleScan();
    // 화면 전환이 끝난 뒤 한 번 더 확인한다.
    setTimeout(() => running && scan(), 1500);
  };
  window.navigation?.addEventListener("navigatesuccess", onNavigated);
  window.addEventListener("popstate", onNavigated);
  window.addEventListener("pageshow", onNavigated);
  // 답글을 접고 펴는 것처럼 화면에 보이는 댓글이 달라지는 경우를 스크롤할 때 다시 센다.
  window.addEventListener(
    "scroll",
    () => {
      if (!running || countTimer) return;
      countTimer = setTimeout(() => {
        countTimer = null;
        if (running) publishCounts();
      }, 600);
    },
    { passive: true, capture: true },
  );
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleThemeSync);
  // 접기·펼치기로 높이가 바뀔 때도 알린다. 버튼이 이벤트 전파를 막으므로 캡처 단계에서 듣는다.
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest(".eml-view")) reportFrameHeight();
    },
    true,
  );

  if (isActive()) start();
}

main();
