// 콘텐츠 스크립트: 댓글을 찾아 두고, 화면에 보이는(곧 보일) 댓글만 분류해 표시한다.
import { findComments, selectorFromClick } from "./detect.js";
import { renderComment, removeView, renderPill, measure, syncTypography, fixClipping } from "./render.js";
import { GROUPS } from "../shared/emotion.js";
import { strip, isUnchanged, hasProfanity } from "../shared/strip.js";

const BATCH = 8;
const MAX_CHARS = 300;
// 화면 위아래로 이만큼 떨어진 댓글까지 미리 처리해, 스크롤했을 때 원문이 보이지 않게 한다.
const PRELOAD_MARGIN = "400px 0px 800px 0px";
const PENDING_TIMEOUT_MS = 8000;
const HANGUL = /[가-힣]/;

const host = location.hostname;
let settings = { enabled: true, fold: true, pillCollapsed: false, disabledHosts: [], selectors: {} };
// textEl -> { item, original, raw, group, view, state: "waiting" | "queued" | "done" }
const tracked = new Map();
const queue = [];
let scanTimer = null;
let pumping = false;
let visibility = null;
// 분류에 걸린 시간 누계 (요약 요소의 data 속성으로 노출해 확인용으로 쓴다)
const stats = { ms: 0, count: 0, threads: 0 };

const rawText = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const readText = (el) => (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

function classify(texts) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "classify", texts }, (res) => {
        if (chrome.runtime.lastError || !res || res.error) {
          console.warn("[emotionless] 분류 실패:", chrome.runtime.lastError?.message ?? res?.error);
          resolve(null);
        } else {
          stats.threads = res.threads;
          stats.ms += res.ms;
          stats.count += texts.length;
          resolve(res.groups);
        }
      });
    } catch (err) {
      console.warn("[emotionless] 분류 요청 실패:", err);
      resolve(null);
    }
  });
}

// 감정별 댓글 수는 화면 구석에 떠 있는 요약 하나에 모은다. 페이지 흐름 밖에 있어 댓글을 밀어내지 않는다.
// 프레임 안의 댓글 수는 맨 위 페이지로 보내 합친다.
const COUNT_MSG = "__emotionless_counts";
const frameCounts = new Map();

function localCounts() {
  const counts = {};
  for (const entry of tracked.values()) if (entry.group) counts[entry.group] = (counts[entry.group] ?? 0) + 1;
  return counts;
}

function showPill() {
  const total = localCounts();
  for (const counts of frameCounts.values()) {
    for (const [group, count] of Object.entries(counts)) total[group] = (total[group] ?? 0) + count;
  }
  renderPill(total, settings.pillCollapsed, () => {
    settings.pillCollapsed = !settings.pillCollapsed;
    chrome.storage.local.set({ pillCollapsed: settings.pillCollapsed });
    showPill();
  });
}

function publishCounts() {
  if (window === window.top) showPill();
  else window.top.postMessage({ type: COUNT_MSG, counts: localCounts() }, "*");
}

function onFrameCounts(event) {
  if (event.data?.type !== COUNT_MSG || !event.source || typeof event.data.counts !== "object") return;
  const clean = {};
  for (const group of Object.keys(GROUPS)) {
    const count = event.data.counts?.[group];
    if (Number.isInteger(count) && count > 0 && count < 100000) clean[group] = count;
  }
  frameCounts.set(event.source, clean);
  showPill();
}

// 댓글이 높이가 고정된 프레임 안에 있으면, 순화본 때문에 늘어난 높이만큼 프레임이 잘린다.
// 프레임 안쪽에서 필요한 높이를 알리고, 바깥쪽에서 그 프레임을 키운다.
const FRAME_MSG = "__emotionless_frame_height";
let reportedHeight = 0;

function reportFrameHeight() {
  if (window === window.top) return;
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

function forget(textEl, entry) {
  visibility.unobserve(textEl);
  removeView(textEl, entry.view);
  tracked.delete(textEl);
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
      // 읽기를 먼저 끝내고 쓰기를 몰아서 한다.
      const metrics = batch.map((textEl) => {
        const entry = tracked.get(textEl);
        return entry && groups && textEl.isConnected ? measure(textEl, entry.item) : null;
      });
      const inPlace = [];
      batch.forEach((textEl, index) => {
        const entry = tracked.get(textEl);
        textEl.removeAttribute("data-eml-pending");
        if (!entry) return;
        if (!metrics[index]) {
          forget(textEl, entry);
          return;
        }
        const cleaned = strip(entry.original);
        // 욕설이 있는데 모델이 중립으로 본 댓글은 분노로 표시한다.
        entry.group = groups[index] === "neutral" && hasProfanity(entry.original) ? "anger" : groups[index];
        entry.state = "done";
        const data = {
          group: entry.group,
          original: entry.original,
          cleaned,
          changed: !isUnchanged(entry.original, cleaned),
        };
        entry.view = renderComment(textEl, data, settings, metrics[index]);
        if (!entry.view) {
          inPlace.push({
            textEl,
            item: entry.item,
            wasClipped: metrics[index].clipped,
            fallback: () => {
              removeView(textEl, null);
              entry.view = renderComment(textEl, data, settings, metrics[index], { forceView: true });
            },
          });
        }
      });
      fixClipping(inPlace);
      publishCounts();
      reportFrameHeight();
      if (!groups) {
        // 분류가 실패하면 남은 댓글의 흐림 처리를 풀고 멈춘다.
        for (const textEl of queue.splice(0)) textEl.removeAttribute("data-eml-pending");
        break;
      }
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

function scan() {
  // 사라졌거나 내용이 바뀐 댓글 정리 (사이트가 요소를 재사용하는 경우)
  for (const [textEl, entry] of tracked) {
    const stale = !textEl.isConnected || rawText(textEl) !== entry.raw || (entry.view && !entry.view.isConnected);
    if (stale) forget(textEl, entry);
  }
  for (const { item, textEl } of findComments(settings.selectors[host] ?? null)) {
    if (tracked.has(textEl)) continue;
    const original = readText(textEl);
    if (!original || !HANGUL.test(original)) continue;
    tracked.set(textEl, { item, original, raw: rawText(textEl), group: null, view: null, state: "waiting" });
    // 처리 전 원문이 읽히지 않도록 흐리게 해 둔다.
    textEl.setAttribute("data-eml-pending", "");
    visibility.observe(textEl);
  }
}

// 사이트 테마가 바뀌면 순화본에 옮겨 둔 글자색을 다시 맞춘다.
let themeTimer = null;
function scheduleThemeSync() {
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => {
    const pairs = [];
    for (const [textEl, entry] of tracked) if (entry.view?.isConnected) pairs.push({ textEl, view: entry.view });
    if (pairs.length) syncTypography(pairs);
  }, 300);
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 300);
}

function startPicker() {
  const banner = document.createElement("div");
  banner.className = "eml-picker-banner";
  banner.textContent = "emotionless: 댓글 하나를 클릭하세요 (Esc로 취소)";
  document.documentElement.append(banner);
  let hovered = null;

  const clear = () => hovered?.removeAttribute("data-eml-pick");
  const stopPicking = () => {
    clear();
    banner.remove();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onOver = (event) => {
    clear();
    hovered = event.target;
    hovered.setAttribute("data-eml-pick", "");
  };
  const onKey = (event) => {
    if (event.key === "Escape") stopPicking();
  };
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const selector = selectorFromClick(event.target);
    stopPicking();
    if (!selector) return;
    settings.selectors = { ...settings.selectors, [host]: selector };
    chrome.storage.local.set({ selectors: settings.selectors });
    for (const [textEl, entry] of tracked) forget(textEl, entry);
    queue.length = 0;
    scan();
  };
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

async function main() {
  settings = { ...settings, ...(await chrome.storage.local.get(Object.keys(settings))) };
  if (!settings.enabled || settings.disabledHosts.includes(host)) return;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "pick" && window === window.top) startPicker();
  });

  window.addEventListener("message", growChildFrame);
  if (window === window.top) window.addEventListener("message", onFrameCounts);
  // 접기·펼치기로 높이가 바뀔 때도 알린다.
  // 버튼이 이벤트 전파를 막으므로 캡처 단계에서 듣는다.
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest(".eml-view")) reportFrameHeight();
    },
    true,
  );
  visibility = new IntersectionObserver(onVisible, { rootMargin: PRELOAD_MARGIN });
  const observer = new MutationObserver((mutations) => {
    // 우리가 넣은 요소로 인한 변화는 무시한다.
    const external = mutations.some((m) => {
      const target = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      return target && !target.closest(".eml-view, .eml-pill");
    });
    if (external) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // 테마 전환은 보통 html 이나 body 의 속성을 바꾸거나, 시스템 설정을 따라간다.
  const themeObserver = new MutationObserver(scheduleThemeSync);
  const themeAttributes = { attributes: true, attributeFilter: ["class", "style", "dark", "data-theme", "data-color-mode", "theme"] };
  themeObserver.observe(document.documentElement, themeAttributes);
  themeObserver.observe(document.body, themeAttributes);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleThemeSync);
  scan();
}

main();
