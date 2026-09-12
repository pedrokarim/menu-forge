// Site de Menu Forge : visionneuse des captures, boutons « Copier » et section
// courante dans la navigation. Sans JavaScript, tout reste utilisable (les
// vignettes ouvrent l’image, les commandes se sélectionnent à la main).
(() => {
  /* ---------- Visionneuse ---------- */

  const viewer = document.querySelector('#viewer');
  const shots = [...document.querySelectorAll('.shot')];
  if (viewer && typeof viewer.showModal === 'function' && shots.length > 0) {
    const image = viewer.querySelector('.viewer-image');
    const caption = viewer.querySelector('.viewer-caption');
    let current = 0;

    const show = (index) => {
      current = (index + shots.length) % shots.length;
      const shot = shots[current];
      const thumbnail = shot.querySelector('img');
      image.src = shot.getAttribute('href');
      image.alt = thumbnail?.alt ?? '';
      caption.innerHTML = shot.querySelector('.shot-caption')?.innerHTML ?? '';
    };

    shots.forEach((shot, index) => {
      shot.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        show(index);
        viewer.showModal();
      });
    });

    viewer.querySelector('[data-action="previous"]')?.addEventListener('click', () => show(current - 1));
    viewer.querySelector('[data-action="next"]')?.addEventListener('click', () => show(current + 1));
    viewer.querySelector('[data-action="close"]')?.addEventListener('click', () => viewer.close());
    viewer.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(current - 1);
      else if (event.key === 'ArrowRight') show(current + 1);
    });
    // Un clic sur le fond (hors du cadre) ferme la visionneuse.
    viewer.addEventListener('click', (event) => {
      if (event.target === viewer) viewer.close();
    });
    // Le focus revient sur la vignette ouverte.
    viewer.addEventListener('close', () => shots[current]?.focus());
  }

  /* ---------- Boutons « Copier » ---------- */

  const english = document.documentElement.lang.startsWith('en');
  const TEXT = english
    ? { copied: 'Copied', done: 'Commands copied to the clipboard.', failed: 'Copy failed: select the text manually.' }
    : {
        copied: 'Copié',
        done: 'Commandes copiées dans le presse-papiers.',
        failed: 'Impossible de copier : sélectionnez le texte à la main.',
      };
  const status = document.querySelector('#copy-status');
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.hidden = !navigator.clipboard;
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.dataset.copy);
      if (!source) return;
      // Les invites (« $ ») ne sont pas copiées.
      const text = [...source.querySelectorAll('.line')].map((line) => line.textContent).join('\n') || source.textContent;
      try {
        await navigator.clipboard.writeText(text.trim());
        const label = button.querySelector('.label');
        const previous = label.textContent;
        label.textContent = TEXT.copied;
        if (status) status.textContent = TEXT.done;
        setTimeout(() => {
          label.textContent = previous;
        }, 1600);
      } catch {
        if (status) status.textContent = TEXT.failed;
      }
    });
  }

  /* ---------- Menu de la documentation ---------- */

  // Ouvert par défaut (sans JavaScript, tout reste visible) ; replié sur écran étroit, où il passe au-dessus du texte.
  const docMenu = document.querySelector('.doc-menu');
  if (docMenu && window.matchMedia('(max-width: 1000px)').matches) docMenu.open = false;

  /* ---------- Section courante ---------- */

  const links = new Map(
    [...document.querySelectorAll('.nav a[href^="#"]')].map((link) => [link.getAttribute('href').slice(1), link]),
  );
  const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length > 0) {
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const active = sections.find((section) => visible.has(section.id));
        for (const [id, link] of links) {
          if (active && id === active.id) link.setAttribute('aria-current', 'true');
          else link.removeAttribute('aria-current');
        }
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
  }
})();
