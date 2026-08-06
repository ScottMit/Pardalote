// Pardalote site — shared behaviour
// 1. Highlights the current section in the top nav (via <body data-nav="...">).
// 2. Highlights the current page in the reference sidebar; when several sidebar
//    entries point into the same page (per-function anchors), a scroll-spy
//    highlights the entry whose section is currently in view.
// 3. Scrolls the sidebar so the active entry is visible on load.
(function () {
  const section = document.body.dataset.nav;
  if (section) {
    document.querySelectorAll('nav.site-nav .links a[data-nav]').forEach(a => {
      if (a.dataset.nav === section) a.classList.add('active');
    });
  }

  const refNav = document.querySelector('.ref-nav');

  // Publish the sticky header's height as --header-h so the narrow-screen
  // "Contents" strip can pin itself directly below it (the header wraps to
  // two rows below 680px, so the height isn't a constant).
  const siteNav = document.querySelector('nav.site-nav');
  function setHeaderH() {
    if (siteNav) document.documentElement.style.setProperty('--header-h', siteNav.offsetHeight + 'px');
  }
  setHeaderH();
  addEventListener('resize', setHeaderH);

  // Scroll the sidebar's own scroll area so the active link sits in view.
  function revealActive() {
    if (!refNav) return;
    const a = refNav.querySelector('a.active');
    if (!a) return;
    const nav = refNav.getBoundingClientRect();
    const link = a.getBoundingClientRect();
    if (link.top < nav.top + 8 || link.bottom > nav.bottom - 8) {
      refNav.scrollTop += (link.top - nav.top) - (nav.height - link.height) / 2;
    }
  }

  const here = location.pathname.split('/').pop() || 'index.html';
  // Only the item links (direct children); the <h4> section headings share an
  // href with the item beneath them and must not steal the active state.
  const links = Array.from(document.querySelectorAll('.ref-nav .ref-nav-links > a')).filter(a => {
    const file = a.getAttribute('href').split('#')[0].split('/').pop();
    return file === here;
  });

  if (links.length === 1) {
    links[0].classList.add('active');
  } else if (links.length > 1) {
    const targets = links.map(a => {
      const hash = a.getAttribute('href').split('#')[1];
      return { a, el: hash ? document.getElementById(hash) : null };
    });
    const update = () => {
      let current = targets[0];
      targets.forEach(t => {
        if (t.el && t.el.getBoundingClientRect().top <= 130) current = t;
      });
      links.forEach(l => l.classList.remove('active'));
      current.a.classList.add('active');
    };
    addEventListener('scroll', update, { passive: true });
    update();
  }

  // Narrow-screen "Contents" disclosure: the toggle button is only visible
  // (via CSS) below 900px; .open shows the link list. Tapping a link closes
  // it again so same-page anchor jumps don't leave the list covering the top.
  const toggle = refNav && refNav.querySelector('.ref-nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const open = refNav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
    refNav.addEventListener('click', e => {
      if (e.target.closest('a')) {
        refNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
    // Click anywhere outside the open menu closes it.
    document.addEventListener('click', e => {
      if (refNav.classList.contains('open') && !refNav.contains(e.target)) {
        refNav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Reveal the active entry once the layout is ready.
  revealActive();
  addEventListener('load', revealActive);
})();
