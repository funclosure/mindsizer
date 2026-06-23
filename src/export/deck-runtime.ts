/** Viewer chrome CSS for the sealed deck: one slide at a time, a fixed 1280x720 stage scaled to fit. */
export const DECK_CSS = `
  html, body { margin: 0; height: 100%; background: #070d16; overflow: hidden; }
  body { font-family: "Geist", system-ui, sans-serif; }
  .deck { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  /* Every slide is a FIXED 1280x720 stage — the exact authoring/render canvas — scaled uniformly
     to fit the viewport via --deck-scale. !important so a bespoke slide's own <style> can never
     change the outer frame geometry (some authored slides hard-code their own width/height/position)
     or the one-at-a-time display. This keeps all slides the SAME size and WYSIWYG with the author. */
  .deck section[data-slide-id] {
    display: none !important;
    box-sizing: border-box !important;
    width: 1280px !important;
    height: 720px !important;
    aspect-ratio: auto !important;
    position: relative !important;
    inset: auto !important;
    flex: none !important;
    transform: scale(var(--deck-scale, 1));
    transform-origin: center center;
  }
  .deck section[data-slide-id].is-active { display: flex !important; }
  .deck-counter {
    position: fixed; right: 18px; bottom: 14px;
    font-family: "Geist Mono", monospace; font-size: 11px;
    letter-spacing: 0.16em; color: rgba(243, 239, 229, 0.5);
  }
  .deck-progress {
    position: fixed; left: 0; bottom: 0; height: 2px;
    background: #4DD9E0; width: 0; transition: width 0.2s ease;
  }
`;

/** Inline keyboard-nav runtime carried by the sealed deck (no server at view time). */
export const NAV_JS = `
(function () {
  var slides = Array.prototype.slice.call(
    document.querySelectorAll('.deck section[data-slide-id]')
  );
  if (!slides.length) return;
  var i = 0;
  var counter = document.querySelector('.deck-counter');
  var progress = document.querySelector('.deck-progress');
  function fit() {
    var s = Math.min(window.innerWidth * 0.96 / 1280, window.innerHeight * 0.96 / 720);
    document.documentElement.style.setProperty('--deck-scale', String(s));
  }
  window.addEventListener('resize', fit);
  fit();
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, idx) { s.classList.toggle('is-active', idx === i); });
    if (counter) counter.textContent = pad(i + 1) + ' / ' + pad(slides.length);
    if (progress) progress.style.width = ((i + 1) / slides.length * 100) + '%';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault(); show(i + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault(); show(i - 1);
    }
  });
  show(0);
})();
`;
