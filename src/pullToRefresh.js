// Puxar para atualizar (iOS/Android em modo app instalado, onde o navegador não oferece)
export function initPullToRefresh() {
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!standalone || window.__ptr) return;
  window.__ptr = true;
  const TH = 78, MAX = 120;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:50%;top:0;width:36px;height:36px;margin-left:-18px;border-radius:50%;background:#1a1a1a;border:1px solid #DD8B3455;box-shadow:0 4px 14px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:99999;pointer-events:none;opacity:0;transform:translateY(-50px)";
  el.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DD8B34" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>';
  const svg = el.firstChild;
  document.body.appendChild(el);
  const style = document.createElement("style");
  style.textContent = "@keyframes ptrspin{to{transform:rotate(360deg)}}";
  document.head.appendChild(style);

  let sx = 0, sy = 0, dy = 0, on = false, busy = false;
  const top = () => "calc(env(safe-area-inset-top) + 8px)";
  el.style.top = top();

  function canStart(t) {
    for (let n = t; n && n !== document.documentElement; n = n.parentElement) {
      if (n.nodeType !== 1) continue;
      const cs = getComputedStyle(n);
      if (cs.position === "fixed" && n !== el) return false; // modais e barras fixas
      if ((cs.overflowY === "auto" || cs.overflowY === "scroll") && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return false;
      if (n.tagName === "TEXTAREA" || n.tagName === "INPUT" || n.tagName === "SELECT") return false;
    }
    return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
  }
  function show(d) {
    const p = Math.min(1, d / TH);
    el.style.opacity = String(Math.min(1, p * 1.4));
    el.style.transform = `translateY(${Math.min(d, MAX) * 0.55 - 40}px)`;
    svg.style.transform = `rotate(${p * 270}deg)`;
    el.style.borderColor = p >= 1 ? "#DD8B34" : "#DD8B3455";
  }
  function reset() {
    el.style.transition = "transform .2s, opacity .2s";
    el.style.opacity = "0";
    el.style.transform = "translateY(-50px)";
    setTimeout(() => { el.style.transition = ""; }, 220);
  }
  document.addEventListener("touchstart", e => {
    if (busy || e.touches.length !== 1) { on = false; return; }
    on = canStart(e.target);
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!on || busy) return;
    const dx = e.touches[0].clientX - sx;
    const d = e.touches[0].clientY - sy;
    if (d <= 0 || Math.abs(dx) > Math.abs(d)) { if (d <= 0) { on = false; reset(); } return; }
    dy = d;
    if (e.cancelable) e.preventDefault();
    show(d * 0.6);
  }, { passive: false });
  const end = () => {
    if (!on || busy) return;
    on = false;
    if (dy * 0.6 >= TH) {
      busy = true;
      el.style.transition = "transform .15s";
      el.style.opacity = "1";
      el.style.transform = "translateY(26px)";
      svg.style.transform = "";
      svg.style.animation = "ptrspin .7s linear infinite";
      setTimeout(() => window.location.reload(), 250);
    } else reset();
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", () => { if (on && !busy) { on = false; reset(); } }, { passive: true });
}
