// 댓글 위치 직접 지정. 마우스를 올리면 같은 모양의 댓글이 함께 표시되고, 클릭하면 그 위치를 저장한다.
// 댓글이 프레임 안에 있을 수 있으므로 모든 프레임에서 함께 동작하고, 안내 문구는 맨 위 페이지에만 띄운다.
import { selectorFromClick } from "./detect.js";

const PICK_MSG = "__emotionless_pick";
const isTop = window === window.top;

let active = null;
let banner = null;
let bannerTimer = null;

function setBanner(text, tone) {
  if (!isTop) return;
  clearTimeout(bannerTimer);
  if (!banner || !banner.isConnected) {
    banner = document.createElement("div");
    banner.className = "eml-picker-banner";
    banner.setAttribute("role", "status");
    document.documentElement.append(banner);
  }
  banner.textContent = text;
  banner.dataset.tone = tone ?? "";
}

function hideBanner(afterMs = 0) {
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner?.remove(), afterMs);
}

function describe({ count, saved }) {
  if (saved) return [`댓글 위치를 저장했어요. 댓글 ${count}개를 찾았어요.`, "done"];
  if (count > 1) return [`댓글 ${count}개가 선택돼요. 클릭하면 저장해요. (Esc로 취소)`, "ready"];
  if (count === 0) return ["여기는 댓글 목록으로 보이지 않아요. 댓글 글 위에 올려 보세요. (Esc로 취소)", "none"];
  return ["댓글 하나에 마우스를 올려 보세요. 같은 모양의 댓글이 함께 표시돼요. (Esc로 취소)", ""];
}

// 프레임 안에서 일어난 일을 맨 위 페이지의 안내 문구에 반영한다.
function report(state) {
  if (isTop) {
    setBanner(...describe(state));
    if (state.saved) hideBanner(2600);
  } else {
    window.top.postMessage({ type: PICK_MSG, count: state.count, saved: !!state.saved }, "*");
  }
}

if (isTop) {
  window.addEventListener("message", (event) => {
    if (event.data?.type !== PICK_MSG || !banner) return;
    const count = Number.isInteger(event.data.count) ? Math.max(0, Math.min(event.data.count, 99999)) : null;
    setBanner(...describe({ count, saved: event.data.saved === true }));
    if (event.data.saved === true) hideBanner(2600);
  });
}

/** @param {(selector: string) => void} onPicked */
export function startPicker(onPicked) {
  if (active) return;
  let marked = [];
  let lastTarget = null;
  let selector = null;

  const clearMarks = () => {
    for (const el of marked) el.removeAttribute("data-eml-pick");
    marked = [];
  };
  const onOver = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target === lastTarget || target.closest(".eml-picker-banner, .eml-pill")) return;
    lastTarget = target;
    clearMarks();
    selector = selectorFromClick(target);
    if (selector) {
      try {
        marked = [...document.querySelectorAll(selector)];
      } catch {
        marked = [];
      }
    }
    for (const el of marked) el.setAttribute("data-eml-pick", "");
    report({ count: marked.length });
  };
  const finish = (cancelled) => {
    // 다른 프레임의 지정 모드도 함께 끝낸다.
    try {
      chrome.runtime.sendMessage({ type: "pick-done", cancelled });
    } catch {}
    stopPicker();
  };
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // 댓글 위치 저장은 사람이 실제로 누른 경우에만 한다.
    if (!event.isTrusted) return;
    const count = marked.length;
    const picked = count > 1 ? selector : null;
    if (!picked) return;
    finish(false);
    report({ count, saved: true });
    onPicked(picked);
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    finish(true);
  };

  active = { clearMarks, onOver, onClick, onKey };
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.documentElement.setAttribute("data-eml-picking", "");
  if (isTop) setBanner(...describe({ count: null }));
}

/** @param {boolean} [keepBanner] 저장 안내를 잠시 보여 줄 때는 문구를 바로 지우지 않는다. */
export function stopPicker(keepBanner = false) {
  if (!active) {
    if (isTop && !keepBanner && banner?.dataset.tone !== "done") hideBanner();
    return;
  }
  active.clearMarks();
  document.removeEventListener("mouseover", active.onOver, true);
  document.removeEventListener("click", active.onClick, true);
  document.removeEventListener("keydown", active.onKey, true);
  document.documentElement.removeAttribute("data-eml-picking");
  active = null;
  if (isTop && !keepBanner && banner?.dataset.tone !== "done") hideBanner();
}
