// Pardalote site — shared behaviour
// 1. Highlights the current section in the top nav (via <body data-nav="...">).
// 2. Highlights the current page in the reference sidebar; when several sidebar
//    entries point into the same page (per-function anchors), a scroll-spy
//    highlights the entry whose section is currently in view.
(function () {
  const section = document.body.dataset.nav;
  if (section) {
    document.querySelectorAll('nav.site-nav .links a[data-nav]').forEach(a => {
      if (a.dataset.nav === section) a.classList.add('active');
    });
  }

  const here = location.pathname.split('/').pop() || 'index.html';
  const links = Array.from(document.querySelectorAll('.ref-nav a')).filter(a => {
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
})();
