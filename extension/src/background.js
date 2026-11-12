// 서비스 워커: 모델을 실행하는 오프스크린 문서를 띄우고 분류 요청을 전달한다.

let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "댓글 감정 분류 모델을 기기 안에서 실행합니다.",
    })
    .finally(() => (creating = null));
  await creating;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "classify" || msg.target === "offscreen") return false;
  (async () => {
    try {
      await ensureOffscreen();
      sendResponse(await chrome.runtime.sendMessage({ target: "offscreen", type: "classify", texts: msg.texts }));
    } catch (err) {
      sendResponse({ error: String(err?.message ?? err) });
    }
  })();
  return true;
});
