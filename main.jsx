import React from "react";
import ReactDOM from "react-dom/client";
import App from "./ai-ads-app.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ลงทะเบียน service worker (PWA + push) — เฉพาะ production ที่เสิร์ฟผ่าน https
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW register failed", e));
  });
}
