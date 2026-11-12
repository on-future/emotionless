// 설정 팝업. 값은 chrome.storage.local 에 저장하고, 바꾸면 현재 탭을 새로 고친다.

const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, fold: true, disabledHosts: [], selectors: {} };

async function main() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = "";
  try {
    const url = new URL(tab?.url ?? "");
    if (/^https?:$/.test(url.protocol)) host = url.hostname;
  } catch {}

  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  const save = async (patch) => {
    Object.assign(settings, patch);
    await chrome.storage.local.set(patch);
    if (tab?.id) chrome.tabs.reload(tab.id);
  };

  $("enabled").checked = settings.enabled;
  $("fold").checked = settings.fold;
  $("host").textContent = host || "이 페이지에서는 사용할 수 없습니다";
  $("site").checked = host ? !settings.disabledHosts.includes(host) : false;
  for (const id of ["site", "pick", "reset"]) $(id).disabled = !host;
  $("reset").disabled = !host || !settings.selectors[host];

  $("enabled").addEventListener("change", (e) => save({ enabled: e.target.checked }));
  $("fold").addEventListener("change", (e) => save({ fold: e.target.checked }));
  $("site").addEventListener("change", (e) => {
    const others = settings.disabledHosts.filter((h) => h !== host);
    save({ disabledHosts: e.target.checked ? others : [...others, host] });
  });
  $("pick").addEventListener("click", async () => {
    await chrome.tabs.sendMessage(tab.id, { type: "pick" }).catch(() => {});
    window.close();
  });
  $("reset").addEventListener("click", () => {
    const { [host]: _removed, ...rest } = settings.selectors;
    save({ selectors: rest });
  });
}

main();
