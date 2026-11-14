// Puxar para atualizar (iOS/Android em modo app instalado, onde o navegador não oferece)
export function initPullToRefresh() {
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (!standalone || window.__ptr) return;
  window.__ptr = true;
  const TH = 60, MAX = 110;
  const R = 22, C = 2 * Math.PI * R;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:50%;top:0;width:140px;margin-left:-70px;display:flex;flex-direction:column;align-items:center;gap:7px;z-index:99999;pointer-events:none;opacity:0;transform:translateY(-60px)";
  el.innerHTML =
    '<div style="position:relative;width:52px;height:52px;border-radius:50%;background:#0a0a0a;box-shadow:0 6px 20px rgba(0,0,0,.45),0 0 0 1px #2a2a2a">' +
      '<svg id="ptr-ring" width="52" height="52" viewBox="0 0 52 52" style="position:absolute;inset:0;transform:rotate(-90deg)">' +
        '<circle cx="26" cy="26" r="' + R + '" fill="none" stroke="#2a2a2a" stroke-width="2"/>' +
        '<circle id="ptr-arc" cx="26" cy="26" r="' + R + '" fill="none" stroke="#DD8B34" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/>' +
      '</svg>' +
      '<img src="/osc-mark-dark.png" alt="" style="position:absolute;left:50%;top:50%;width:26px;transform:translate(-50%,-50%);opacity:.95"/>' +
    '</div>' +
    '<div id="ptr-txt" style="font:600 8px/1 Inter,\'Segoe UI\',sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#DD8B34;white-space:nowrap;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:99px;padding:6px 10px 6px calc(10px + .28em);box-shadow:0 4px 14px rgba(0,0,0,.4)">Puxe para atualizar</div>';
  const ring = el.querySelector("#ptr-ring"), arc = el.querySelector("#ptr-arc"), txt = el.querySelector("#ptr-txt");
  document.body.appendChild(el);
  const style = document.createElement("style");
  style.textContent = "@keyframes ptrspin{from{transform:rotate(-90deg)}to{transform:rotate(270deg)}}";
  document.head.appendChild(style);

  let sx = 0, sy = 0, dy = 0, on = false, busy = false;
  el.style.top = "calc(env(safe-area-inset-top) + 30px)";

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
    el.style.opacity = String(Math.min(1, p * 2.5));
    el.style.transform = `translateY(${Math.min(d, MAX) * 0.7 - 30}px)`;
    arc.style.strokeDashoffset = String(C * (1 - p));
    txt.textContent = p >= 1 ? "Solte para atualizar" : "Puxe para atualizar";
  }
  function reset() {
    el.style.transition = "transform .2s, opacity .2s";
    el.style.opacity = "0";
    el.style.transform = "translateY(-60px)";
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
      el.style.transform = "translateY(30px)";
      txt.textContent = "Atualizando";
      arc.style.strokeDashoffset = String(C * 0.72);
      ring.style.animation = "ptrspin .8s linear infinite";
      setTimeout(() => window.location.reload(), 250);
    } else reset();
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", () => { if (on && !busy) { on = false; reset(); } }, { passive: true });
}
