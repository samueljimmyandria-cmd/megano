// ===== MEGANO — Shared Interactions =====

(function () {
  'use strict';

  // Mark current page in nav
  function markActiveNav() {
    const path = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const href = a.getAttribute('href');
      if (href === path || (path === '' && href === 'index.html')) {
        a.classList.add('active');
      }
    });
  }

  // IntersectionObserver fade-up
  function setupReveal() {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in-view');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
  }

  // Smooth-scroll for in-page anchors
  function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (ev) => {
        const id = a.getAttribute('href').slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (target) {
          ev.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // Cursor parallax for hero
  function setupCursorParallax() {
    const hero = document.querySelector('[data-parallax]');
    if (!hero) return;
    const layers = hero.querySelectorAll('[data-parallax-layer]');
    if (!layers.length) return;

    let raf = null;
    let targetX = 0,
      targetY = 0,
      curX = 0,
      curY = 0;

    function onMove(ev) {
      const rect = hero.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      targetX = (ev.clientX - cx) / rect.width;
      targetY = (ev.clientY - cy) / rect.height;
      if (!raf) raf = requestAnimationFrame(update);
    }
    function update() {
      curX += (targetX - curX) * 0.08;
      curY += (targetY - curY) * 0.08;
      layers.forEach((layer) => {
        const depth = parseFloat(layer.dataset.parallaxLayer) || 1;
        layer.style.transform = `translate3d(${curX * depth * 30}px, ${curY * depth * 20}px, 0)`;
      });
      if (Math.abs(targetX - curX) > 0.001 || Math.abs(targetY - curY) > 0.001) {
        raf = requestAnimationFrame(update);
      } else {
        raf = null;
      }
    }
    hero.addEventListener('mousemove', onMove);
    hero.addEventListener('mouseleave', () => {
      targetX = 0;
      targetY = 0;
      if (!raf) raf = requestAnimationFrame(update);
    });
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  function init() {
    markActiveNav();
    setupReveal();
    setupSmoothScroll();
    setupCursorParallax();
  }
})();