const $ = (id) => document.getElementById(id);

async function refresh() {
  const { url, token, lastSync } = await chrome.storage.local.get(["url", "token", "lastSync"]);
  if (url) $("url").value = url;
  if (token) $("token").value = token;
  if (lastSync) {
    const when = new Date(lastSync.at).toLocaleString("th-TH");
    $("status").className = lastSync.ok ? "ok" : "err";
    $("status").textContent = (lastSync.ok ? "✓ ส่งสำเร็จ" : "✗ " + (lastSync.error || "ไม่สำเร็จ")) + " · " + when + " (" + lastSync.reason + ")";
  }
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({ url: $("url").value.trim(), token: $("token").value.trim() });
  $("status").className = "ok"; $("status").textContent = "บันทึกแล้ว";
});

$("send").addEventListener("click", async () => {
  await chrome.storage.local.set({ url: $("url").value.trim(), token: $("token").value.trim() });
  $("status").className = ""; $("status").textContent = "กำลังส่ง...";
  const res = await chrome.runtime.sendMessage({ type: "send-now" });
  $("status").className = res && res.ok ? "ok" : "err";
  $("status").textContent = res && res.ok ? "✓ ส่งคุกกี้เข้าระบบแล้ว" : "✗ " + ((res && res.error) || "ไม่สำเร็จ");
});

refresh();
