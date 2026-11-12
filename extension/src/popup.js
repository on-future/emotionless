// 설정 팝업. 현재 페이지의 댓글 분위기를 보여 주고, 설정을 바꾸면 새로 고침 없이 바로 적용된다.
import { GROUPS, GROUP_ORDER, rankGroups } from "./shared/emotion.js";

const DEFAULTS = { enabled: true, fold: true, showPill: true, disabledHosts: [], selectors: {} };
const POLL_MS = 1000;

// 가장 많은 감정에 따라 보여 주는 한 줄
const HEADLINES = {
  complaint: "불만 섞인 댓글이 가장 많아요",
  anger: "화난 댓글이 가장 많아요",
  blame: "비난하는 댓글이 가장 많아요",
  sad: "슬퍼하는 댓글이 가장 많아요",
  fear: "걱정하는 댓글이 가장 많아요",
  surprise: "놀란 댓글이 가장 많아요",
  positive: "좋게 보는 댓글이 가장 많아요",
  neutral: "담담한 댓글이 가장 많아요",
};

const $ = (id) => document.getElementById(id);
const emojiUrl = (group) => chrome.runtime.getURL(`emoji/${group}.png`);

let settings = { ...DEFAULTS };
let tab = null;
// null: 이 페이지의 콘텐츠 스크립트가 응답하지 않음
let status = null;

async function findTab() {
  // 개발·시험용: popup.html?tab=<탭 id> 로 열면 그 탭을 대상으로 한다.
  const forced = new URLSearchParams(location.search).get("tab");
  if (forced) return chrome.tabs.get(Number(forced)).catch(() => null);
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active ?? null;
}

async function ask(message) {
  if (tab?.id == null) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id, message)) ?? null;
  } catch {
    return null;
  }
}

function pageHost() {
  if (status?.host) return status.host;
  try {
    const url = new URL(tab?.url ?? "");
    return /^https?:$/.test(url.protocol) ? url.hostname : "";
  } catch {
    return "";
  }
}

// 페이지 종류: ok(동작 중이거나 켤 수 있음) / reload(새로 고쳐야 시작) / unsupported(확장이 동작할 수 없는 페이지)
function pageKind() {
  if (status) return "ok";
  if (!tab?.url) return "reload";
  return /^https?:/.test(tab.url) ? "reload" : "unsupported";
}

function setMood({ state, group = "neutral", title, sub, counts = null, showReload = false }) {
  const mood = $("mood");
  mood.dataset.state = state;
  mood.dataset.group = group;
  $("moodFace").src = emojiUrl(group);
  $("moodTitle").textContent = title;
  $("moodSub").textContent = sub;
  $("reload").hidden = !showReload;

  const bar = $("bar");
  const chips = $("chips");
  bar.hidden = chips.hidden = !counts;
  if (!counts) return;

  if (!bar.childElementCount) {
    for (const g of GROUP_ORDER) {
      const seg = document.createElement("span");
      seg.className = "seg";
      seg.dataset.group = g;
      bar.append(seg);
    }
  }
  // 댓글이 많은 감정부터 늘어놓는다. 막대는 요소를 그대로 두고 순서만 바꿔 길이 변화가 부드럽게 이어진다.
  const ranked = rankGroups(counts);
  for (const seg of bar.children) {
    const count = counts[seg.dataset.group] ?? 0;
    seg.style.flexGrow = String(count);
    seg.style.order = String(ranked.indexOf(seg.dataset.group));
    seg.toggleAttribute("data-on", count > 0);
  }
  bar.setAttribute("aria-label", ranked.map((g) => `${GROUPS[g].label} ${counts[g]}`).join(", "));

  chips.replaceChildren(
    ...ranked.map((g) => {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = emojiUrl(g);
      img.alt = "";
      const count = document.createElement("b");
      count.textContent = String(counts[g]);
      li.append(img, `${GROUPS[g].label} `, count);
      return li;
    }),
  );
}

function render() {
  const kind = pageKind();
  const host = pageHost();
  const siteOn = host ? !settings.disabledHosts.includes(host) : false;
  const working = kind === "ok" && settings.enabled && siteOn;
  const counts = status?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const custom = (status?.customHosts ?? []).length > 0;

  $("enabled").checked = settings.enabled;
  $("fold").checked = settings.fold;
  $("showPill").checked = settings.showPill;
  $("site").checked = siteOn;
  $("host").textContent = host;
  $("siteGroup").hidden = !host;
  $("locationGroup").hidden = !host;
  $("controls").toggleAttribute("data-dim", !settings.enabled);
  for (const id of ["site", "fold", "showPill"]) $(id).disabled = !settings.enabled;

  $("pick").disabled = !working;
  $("pick").textContent = custom ? "다시 지정" : "직접 지정";
  $("resetPick").hidden = !custom;
  $("resetPick").disabled = !working;
  $("locationSub").textContent = custom
    ? "직접 알려 준 위치를 쓰고 있어요."
    : "자동으로 찾고 있어요. 댓글이 그대로 보이면 직접 알려 주세요.";
  // 댓글을 못 찾았을 때는 위치 지정이 다음에 할 일이므로 눈에 띄게 한다.
  $("pick").classList.toggle("btn-primary", working && total === 0 && !custom);

  if (kind === "unsupported") {
    setMood({
      state: "unsupported",
      title: "이 페이지에서는 쓸 수 없어요",
      sub: "브라우저 설정이나 스토어 같은 페이지에서는 동작하지 않아요.",
    });
  } else if (!settings.enabled) {
    setMood({ state: "off", title: "꺼져 있어요", sub: "켜면 댓글의 날 선 표현을 걷어 내요." });
  } else if (!siteOn) {
    setMood({ state: "off", title: "이 사이트에서는 쉬는 중이에요", sub: "아래에서 다시 켤 수 있어요." });
  } else if (kind === "reload") {
    setMood({
      state: "reload",
      title: "페이지를 새로 고치면 시작해요",
      sub: "설치하기 전에 열어 둔 페이지라 아직 적용되지 않았어요.",
      showReload: true,
    });
  } else if (total === 0) {
    setMood({
      state: "empty",
      title: "아직 댓글을 찾지 못했어요",
      sub: "댓글이 있는 곳까지 내려 보세요. 화면에 보이는 댓글부터 처리해요.",
    });
  } else {
    const top = rankGroups(counts)[0];
    setMood({
      state: "counts",
      group: top,
      title: HEADLINES[top],
      sub: `지금까지 본 댓글 ${total}개 가운데 ${counts[top]}개`,
      counts,
    });
  }
}

let saving = false;

async function refresh() {
  const [nextStatus, stored] = await Promise.all([ask({ type: "status" }), chrome.storage.local.get(Object.keys(DEFAULTS))]);
  status = nextStatus;
  // 페이지에서 바뀐 설정(직접 지정한 댓글 위치 등)을 따라간다. 저장 중일 때는 방금 고른 값을 덮어쓰지 않는다.
  if (!saving) settings = { ...DEFAULTS, ...stored };
  render();
}

async function save(patch) {
  saving = true;
  Object.assign(settings, patch);
  render();
  await chrome.storage.local.set(patch);
  saving = false;
  // 콘텐츠 스크립트가 반영한 뒤의 상태를 바로 다시 읽는다.
  setTimeout(refresh, 250);
}

async function main() {
  $("version").textContent = `버전 ${chrome.runtime.getManifest().version}`;
  settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  tab = await findTab();
  await refresh();
  setInterval(refresh, POLL_MS);

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  $("fold").addEventListener("change", (e) => save({ fold: e.target.checked }));
  $("showPill").addEventListener("change", (e) => save({ showPill: e.target.checked }));
  $("site").addEventListener("change", (e) => {
    const host = pageHost();
    if (!host) return;
    const others = settings.disabledHosts.filter((h) => h !== host);
    save({ disabledHosts: e.target.checked ? others : [...others, host] });
  });
  $("pick").addEventListener("click", async () => {
    await ask({ type: "pick" });
    // 팝업이 페이지를 가리므로 닫아서 바로 고를 수 있게 한다.
    window.close();
  });
  $("resetPick").addEventListener("click", () => {
    const selectors = { ...settings.selectors };
    for (const host of status?.customHosts ?? []) delete selectors[host];
    save({ selectors });
  });
  $("reload").addEventListener("click", () => {
    if (tab?.id != null) chrome.tabs.reload(tab.id);
    window.close();
  });
}

main();
