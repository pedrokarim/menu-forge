/**
 * Audit de mise en page : rien ne doit dépasser de son conteneur visible, se
 * superposer à un voisin ni faire défiler la page à l’horizontale. Lu dans la
 * page, sans capture d’écran.
 *
 * Règles, pour chaque élément affiché (plus de 2 px de côté, visible) :
 * - s’il a un ancêtre qui le rogne (`overflow` `hidden` ou `clip` sur un axe),
 *   il doit tenir dans la boîte de cet ancêtre sur cet axe ; un ancêtre qui
 *   défile (`auto`, `scroll`) le rend atteignable et arrête la recherche ;
 * - sinon, il doit tenir dans la fenêtre (dialogues compris) ;
 * - un élément qui rogne son propre contenu (`overflow` `hidden`) sans points
 *   de suspension ne doit pas avoir de contenu plus large que lui ;
 * - un élément qui ne rogne pas (`overflow` `visible`) ne doit pas laisser
 *   son contenu baver hors de sa boîte (texte trop long d’un onglet…) ;
 * - un texte coupé par des points de suspension doit pouvoir se lire en entier
 *   (attribut `title` sur lui ou un ancêtre, ou nom accessible identique) ;
 * - deux contrôles ou deux textes d’un même calque ne se chevauchent pas
 *   (un menu contextuel, une infobulle ou un dialogue sont d’autres calques) ;
 * - rien ne recouvre le dialogue du dessus ;
 * - une notification (pile en bas à droite, calque à part) ne recouvre ni la
 *   barre d’état, ni le rail, ni la barre de titre, ni un dialogue ; dans un
 *   éditeur, elle reste sur la toile (jamais sur les panneaux) ;
 * - dans une barre d’outils, les contrôles d’une même rangée ont la même
 *   hauteur et le même centre vertical (à 1 px près), et aucun contrôle isolé
 *   ne passe seul à la ligne (un groupe entier, oui) ;
 * - dans une barre d’onglets (`role="tablist"`), les onglets frères ont la
 *   même hauteur et, sur une même rangée, le même haut (à 1 px près).
 *
 * Exemptions : `[data-audit-exempt]` et ses descendants, les toiles
 * (`canvas`), l’intérieur des SVG ; les éléments à points de suspension et
 * leurs descendants pour les règles de débordement (le texte coupé y est voulu).
 */
export async function auditLayout(page, options = {}) {
  return page.evaluate(({ limit = 40 }) => {
    const NBSP = String.fromCharCode(160);
    const problems = [];
    const TOLERANCE = 1;
    const doc = document.documentElement;
    const viewWidth = doc.clientWidth;
    const viewHeight = doc.clientHeight;
    if (doc.scrollWidth > viewWidth + TOLERANCE) {
      problems.push(`page${NBSP}: défilement horizontal (${doc.scrollWidth} px pour ${viewWidth} px)`);
    }
    // L’appli tient dans la fenêtre : ce sont ses colonnes et ses panneaux qui défilent, jamais la page entière.
    if (doc.scrollHeight > viewHeight + TOLERANCE) {
      problems.push(`page${NBSP}: défilement vertical (${doc.scrollHeight} px pour ${viewHeight} px)`);
    }

    const describe = (element) => {
      const classes = [...element.classList].slice(0, 3).map((name) => `.${name}`).join('');
      const label = element.getAttribute('aria-label') ?? element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
      return `${element.tagName.toLowerCase()}${classes}${label ? ` « ${label} »` : ''}`;
    };
    const exempt = (element) => element.closest('[data-audit-exempt]') !== null;
    const shown = (element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const ellipsisAncestor = (element) => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).textOverflow === 'ellipsis') return true;
      }
      return false;
    };
    /** Ancêtre qui rogne sur un axe, ou `null` (un ancêtre qui défile arrête la recherche : contenu atteignable). */
    const clipperOf = (element, axis) => {
      // Un élément fixe est contenu par la fenêtre, pas par ses ancêtres.
      if (getComputedStyle(element).position === 'fixed') return null;
      for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        const overflow = axis === 'x' ? style.overflowX : style.overflowY;
        if (overflow === 'hidden' || overflow === 'clip') return { node, scrolls: false };
        if (overflow === 'auto' || overflow === 'scroll') return { node, scrolls: true };
        if (style.position === 'fixed') return null;
      }
      return null;
    };
    /** Partie réellement visible d’une boîte : recoupée par les ancêtres qui rognent ou défilent, puis par la fenêtre. */
    const visiblePart = (element, rect) => {
      let { left, top, right, bottom } = rect;
      if (getComputedStyle(element).position !== 'fixed') {
        for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          if (style.overflowX !== 'visible') {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
          }
          if (style.overflowY !== 'visible') {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
          }
          if (style.position === 'fixed') break;
        }
      }
      left = Math.max(left, 0);
      top = Math.max(top, 0);
      right = Math.min(right, viewWidth);
      bottom = Math.min(bottom, viewHeight);
      return right - left > 0 && bottom - top > 0 ? { left, top, right, bottom } : null;
    };
    const push = (message) => {
      if (problems.length < limit) problems.push(message);
    };

    /* ---------- Débordements ---------- */

    const NO_CONTENT = new Set(['canvas', 'svg', 'img', 'input', 'select', 'textarea', 'video', 'iframe', 'html', 'body']);
    const reported = new Set();
    for (const element of document.body.querySelectorAll('*')) {
      if (problems.length >= limit) break;
      if (exempt(element) || (element.closest('svg') && element.tagName.toLowerCase() !== 'svg')) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 2 || rect.height <= 2) continue;
      if (!shown(element)) continue;
      if ([...reported].some((node) => node.contains(element))) continue;
      const style = getComputedStyle(element);
      const tag = element.tagName.toLowerCase();

      // Texte coupé par des points de suspension : le passage à la ligne est la règle. Seule exception,
      // une bande d’une seule ligne (barre d’état, pied de toile) marquée `data-audit-ellipsis`, et
      // encore : le texte entier doit se lire au survol (`title`).
      if (style.textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth + TOLERANCE && style.overflowX !== 'visible') {
        const full = (element.textContent ?? '').trim();
        if (full && !element.closest('[data-audit-ellipsis]')) {
          push(`${describe(element)} coupé par des points de suspension au lieu de passer à la ligne (${element.scrollWidth} px pour ${element.clientWidth} px)`);
          reported.add(element);
          continue;
        }
        if (full && !element.closest('[title]')) {
          push(`${describe(element)} coupé sans infobulle (${element.scrollWidth} px pour ${element.clientWidth} px)`);
          reported.add(element);
          continue;
        }
      }
      if (ellipsisAncestor(element)) continue;

      for (const axis of ['x', 'y']) {
        const start = axis === 'x' ? rect.left : rect.top;
        const end = axis === 'x' ? rect.right : rect.bottom;
        const clipper = clipperOf(element, axis);
        let bounds;
        if (clipper) {
          if (clipper.scrolls) continue;
          const box = clipper.node.getBoundingClientRect();
          bounds = axis === 'x' ? [box.left, box.right] : [box.top, box.bottom];
        } else {
          bounds = axis === 'x' ? [0, viewWidth] : [0, viewHeight];
        }
        if (start < bounds[0] - TOLERANCE || end > bounds[1] + TOLERANCE) {
          const where = clipper ? `dépasse de ${describe(clipper.node)}` : 'sort de la fenêtre';
          push(`${describe(element)} ${where} (${axis}${NBSP}: ${Math.round(start)}–${Math.round(end)} pour ${Math.round(bounds[0])}–${Math.round(bounds[1])})`);
          reported.add(element);
          break;
        }
      }
      if (reported.has(element) || NO_CONTENT.has(tag) || style.display === 'inline' || style.display === 'contents') continue;
      if (element.clientWidth === 0 || element.clientHeight === 0) continue;
      const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const scrollsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
      const scrollsY = style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (clipsX && element.scrollWidth > element.clientWidth + TOLERANCE) {
        push(`${describe(element)} rogne son contenu (${element.scrollWidth} px pour ${element.clientWidth} px)`);
        reported.add(element);
      } else if (!clipsX && !scrollsX && element.scrollWidth > element.clientWidth + TOLERANCE) {
        push(`${describe(element)} laisse baver son contenu (${element.scrollWidth} px pour ${element.clientWidth} px de large)`);
        reported.add(element);
      } else if (!scrollsY && element.scrollHeight > element.clientHeight + 2) {
        push(`${describe(element)} laisse baver son contenu (${element.scrollHeight} px pour ${element.clientHeight} px de haut)`);
        reported.add(element);
      }
    }

    /* ---------- Chevauchements ---------- */

    const INTERACTIVE =
      'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="tab"], [role="button"], [role="checkbox"], [role="radio"], [role="slider"], [role="separator"][tabindex], label.checkbox';
    // La pile de notifications flotte au-dessus de la page : un calque à part (voir sa règle plus bas).
    const LAYERS = '[role="dialog"], [role="tooltip"], [role="menu"], .context-menu, .tooltip, .toast-stack';
    const items = [];
    /** Rectangles des lignes de texte propres à un élément (un texte qui passe à la ligne en a plusieurs). */
    const textLines = (element) => {
      const lines = [];
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const part of range.getClientRects()) {
          if (part.width > 0 && part.height > 0) lines.push({ left: part.left, top: part.top, right: part.right, bottom: part.bottom });
        }
      }
      return lines;
    };
    /** Boîte englobante des lignes de texte, ou `null`. */
    const textBox = (element) => {
      const lines = textLines(element);
      if (lines.length === 0) return null;
      return {
        left: Math.min(...lines.map((line) => line.left)),
        top: Math.min(...lines.map((line) => line.top)),
        right: Math.max(...lines.map((line) => line.right)),
        bottom: Math.max(...lines.map((line) => line.bottom)),
      };
    };
    for (const element of document.body.querySelectorAll('*')) {
      if (exempt(element) || element.closest('svg')) continue;
      const interactive = element.matches(INTERACTIVE);
      // Texte : un élément qui porte lui-même du texte, hors d’un contrôle (le contrôle le représente).
      const text = !interactive && element.parentElement?.closest(INTERACTIVE) == null && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (!interactive && !text) continue;
      if (interactive && element.parentElement?.closest(INTERACTIVE)) continue;
      if (!shown(element)) continue;
      const boxes = (interactive ? [element.getBoundingClientRect()] : textLines(element)).filter((box) => box.right - box.left > 2 && box.bottom - box.top > 2);
      const parts = boxes.map((box) => visiblePart(element, box)).filter(Boolean);
      if (parts.length === 0) continue;
      // `[data-audit-layered]` : conteneur dont les enfants se superposent exprès (couleurs principale et secondaire…).
      // Calque : dialogue, infobulle, menu… ou en-tête collant (la liste défile dessous, exprès).
      let layer = element.closest(LAYERS);
      for (let node = element; !layer && node && node !== document.body; node = node.parentElement) {
        if (getComputedStyle(node).position === 'sticky') layer = node;
      }
      items.push({ element, parts, layer: layer ?? document.body, layered: element.closest('[data-audit-layered]') });
    }
    let overlaps = 0;
    for (let i = 0; i < items.length && overlaps < 12; i++) {
      for (let j = i + 1; j < items.length && overlaps < 12; j++) {
        const a = items[i];
        const b = items[j];
        if (a.layer !== b.layer || a.element.contains(b.element) || b.element.contains(a.element)) continue;
        if (a.layered && a.layered === b.layered) continue;
        // Plus grand recouvrement entre les lignes (ou boîtes) des deux éléments.
        let width = 0;
        let height = 0;
        for (const pa of a.parts) {
          for (const pb of b.parts) {
            const w = Math.min(pa.right, pb.right) - Math.max(pa.left, pb.left);
            const h = Math.min(pa.bottom, pb.bottom) - Math.max(pa.top, pb.top);
            if (w > 0 && h > 0 && w * h > width * height) [width, height] = [w, h];
          }
        }
        // 3 px : les boutons d’un groupe segmenté partagent leur bordure de 2 px.
        if (width > 3 && height > 3) {
          push(`${describe(a.element)} chevauche ${describe(b.element)} (${Math.round(width)} × ${Math.round(height)} px)`);
          overlaps++;
        }
      }
    }

    /* ---------- Titres cassés, cartes creuses ---------- */

    /** Nombre de lignes occupées par le texte propre d’un élément. */
    const lineCount = (element) => {
      const tops = new Set();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const part of range.getClientRects()) if (part.width > 0 && part.height > 0) tops.add(Math.round(part.top / 4));
      }
      return tops.size;
    };
    // Un titre court (quatre mots au plus) tient sur deux lignes au plus : au-delà, il est cassé mot à mot.
    for (const title of document.querySelectorAll('h1, h2, h3, h4, strong, summary, legend, dt, .doc-name')) {
      if (problems.length >= limit) break;
      if (exempt(title) || !shown(title)) continue;
      const text = (title.textContent ?? '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 40 || text.split(' ').length > 4) continue;
      const lines = lineCount(title);
      if (lines > 2) push(`${describe(title)} cassé sur ${lines} lignes`);
    }
    // Cartes d’une même grille : aucune ne garde un grand vide sous son contenu.
    const cardGrids = new Set([...document.querySelectorAll('.quick-action, .doc-card, .card, .row-card')].map((card) => card.parentElement));
    for (const grid of cardGrids) {
      if (!grid || exempt(grid) || getComputedStyle(grid).display !== 'grid') continue;
      for (const card of grid.children) {
        if (problems.length >= limit || !shown(card)) continue;
        const box = card.getBoundingClientRect();
        let bottom = box.top;
        for (const inner of card.querySelectorAll('*')) {
          if (!shown(inner) || getComputedStyle(inner).position === 'absolute') continue;
          const own = inner.children.length === 0 ? inner.getBoundingClientRect() : textBox(inner);
          if (own) bottom = Math.max(bottom, own.bottom);
        }
        const gap = box.bottom - parseFloat(getComputedStyle(card).paddingBottom) - bottom;
        if (gap > Math.max(40, box.height * 0.35)) push(`${describe(card)} garde un grand vide sous son contenu (${Math.round(gap)} px sur ${Math.round(box.height)} px)`);
      }
    }

    /* ---------- Dialogue du dessus : rien ne le recouvre ---------- */

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((dialog) => shown(dialog));
    const top = dialogs.at(-1);
    if (top) {
      const box = top.getBoundingClientRect();
      search: for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 5; j++) {
          const x = box.left + (box.width * i) / 6;
          const y = box.top + (box.height * j) / 6;
          if (x < 0 || y < 0 || x >= viewWidth || y >= viewHeight) continue;
          const hit = document.elementFromPoint(x, y);
          if (hit && !top.contains(hit) && !hit.closest('[role="tooltip"], .tooltip, [role="menu"], .context-menu')) {
            push(`${describe(top)} recouvert par ${describe(hit)} (${Math.round(x)}, ${Math.round(y)})`);
            break search;
          }
        }
      }
    }

    /* ---------- Notifications : jamais sur la barre d’état, le rail ni un dialogue ---------- */

    const guarded = [...document.querySelectorAll('.statusbar, .rail, .titlebar, [role="dialog"]')].filter((element) => shown(element));
    for (const toast of document.querySelectorAll('.toast-stack .toast, .toast-stack .toast-more')) {
      if (problems.length >= limit) break;
      if (!shown(toast)) continue;
      // Partie visible seulement : dans une pile dépliée qui défile, le reste est caché, il ne recouvre rien.
      const box = visiblePart(toast, toast.getBoundingClientRect());
      if (!box) continue;
      for (const other of guarded) {
        const zone = other.getBoundingClientRect();
        const width = Math.min(box.right, zone.right) - Math.max(box.left, zone.left);
        const height = Math.min(box.bottom, zone.bottom) - Math.max(box.top, zone.top);
        if (width > 1 && height > 1) {
          push(`${describe(toast)} recouvre ${describe(other)} (${Math.round(width)} × ${Math.round(height)} px)`);
          break;
        }
      }
    }

    // Dans un éditeur, la pile s’ancre sur la toile (`ui/ToastStack.tsx`) : elle ne déborde pas sur
    // les panneaux et leurs boutons. Même seuil que le studio : sous 280 × 200 px, coin de la fenêtre.
    let stage = null;
    for (const element of document.querySelectorAll('.shell-editor:not([hidden]) :is(.stage, .asset-stage, .pixel-stage)')) {
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height > (stage ? stage.width * stage.height : 0)) stage = rect;
    }
    if (stage && stage.width >= 280 && stage.height >= 200) {
      for (const toast of document.querySelectorAll('.toast-stack .toast, .toast-stack .toast-more')) {
        if (problems.length >= limit) break;
        if (!shown(toast)) continue;
        const box = visiblePart(toast, toast.getBoundingClientRect());
        if (!box) continue;
        const outside = box.left < stage.left - TOLERANCE || box.right > stage.right + TOLERANCE || box.top < stage.top - TOLERANCE || box.bottom > stage.bottom + TOLERANCE;
        if (outside) push(`${describe(toast)} sort de la toile de l’éditeur, sur ses panneaux`);
      }
    }

    /* ---------- Barres d’outils : hauteurs, centres, orphelins ---------- */

    const TOOLBARS =
      '[role="toolbar"], header.toolbar, .toolbar-group, .asset-toolbar-group, .stage-toolbar-end, .segmented, .asset-segmented, .modal-footer, .section-header';
    const CONTROL = 'button, select, input, textarea, label, [role="group"], .segmented, .asset-segmented';
    const isControl = (element) => element.matches(CONTROL) || element.querySelector('button, select, input') !== null;
    const isGroup = (element) =>
      element.matches('[role="group"], .segmented, .asset-segmented, .toolbar-group, .asset-toolbar-group, .stage-toolbar-end') ||
      element.querySelectorAll('button, select, input').length > 1;
    for (const bar of document.querySelectorAll(TOOLBARS)) {
      if (problems.length >= limit) break;
      // Palette verticale (outils de l’éditeur de pixels) : une colonne, pas des rangées.
      if (exempt(bar) || !shown(bar) || bar.getAttribute('aria-orientation') === 'vertical') continue;
      const children = [...bar.children].filter((child) => {
        if (!shown(child) || child.getAttribute('aria-hidden') === 'true') return false;
        const position = getComputedStyle(child).position;
        if (position === 'absolute' || position === 'fixed') return false;
        const rect = child.getBoundingClientRect();
        return rect.height > 8 && rect.width > 2;
      });
      if (children.length < 2) continue;
      // Rangées : un enfant rejoint la rangée dont la bande verticale contient son centre.
      const rows = [];
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        const center = (rect.top + rect.bottom) / 2;
        const row = rows.find((candidate) => center >= candidate.top && center <= candidate.bottom);
        if (row) row.members.push({ child, rect });
        else rows.push({ top: rect.top, bottom: rect.bottom, members: [{ child, rect }] });
      }
      for (const row of rows) {
        const controls = row.members.filter(({ child }) => isControl(child));
        const reference = controls[0] ?? row.members[0];
        const referenceCenter = (reference.rect.top + reference.rect.bottom) / 2;
        for (const member of row.members) {
          if (member === reference) continue;
          const center = (member.rect.top + member.rect.bottom) / 2;
          const control = isControl(member.child);
          // Hauteurs comparées entre contrôles d’une seule ligne : un groupe replié sur deux rangées ou
          // un nom passé à la ligne (pastille d’espace) est plus haut, et c’est voulu ; son centre, lui, compte.
          const singleLine = (rect) => rect.height <= 40;
          const heightGap =
            control && controls.length > 1 && singleLine(member.rect) && singleLine(reference.rect) ? Math.abs(member.rect.height - reference.rect.height) : 0;
          if (Math.abs(center - referenceCenter) > TOLERANCE || heightGap > TOLERANCE) {
            push(
              `${describe(bar)}${NBSP}: ${describe(member.child)} (${Math.round(member.rect.height)} px de haut, centre ${Math.round(center)}) ` +
                `mal aligné sur ${describe(reference.child)} (${Math.round(reference.rect.height)} px, centre ${Math.round(referenceCenter)})`,
            );
            break;
          }
        }
      }
      if (rows.length > 1 && children.length >= 3) {
        for (const row of rows) {
          if (row.members.length === 1 && !isGroup(row.members[0].child)) {
            push(`${describe(bar)}${NBSP}: ${describe(row.members[0].child)} passe seul à la ligne`);
          }
        }
      }
    }

    /* ---------- Barres d’onglets : même hauteur, même alignement ---------- */

    // Un libellé qui passe à la ligne dans un onglet (« Bibliothèque » sous son picto) ne doit pas
    // le rendre plus haut que ses voisins : tous les onglets d’une barre ont la même hauteur et le même haut.
    for (const bar of document.querySelectorAll('[role="tablist"]')) {
      if (problems.length >= limit) break;
      if (exempt(bar) || !shown(bar)) continue;
      const tabs = [...bar.querySelectorAll('[role="tab"]')].filter((tab) => tab.closest('[role="tablist"]') === bar && shown(tab));
      if (tabs.length < 2) continue;
      const boxes = tabs.map((tab) => ({ tab, rect: tab.getBoundingClientRect() }));
      const reference = boxes[0];
      for (const { tab, rect } of boxes.slice(1)) {
        const sameRow = Math.abs(rect.top - reference.rect.top) < reference.rect.height / 2;
        if (Math.abs(rect.height - reference.rect.height) > TOLERANCE || (sameRow && Math.abs(rect.top - reference.rect.top) > TOLERANCE)) {
          push(
            `${describe(bar)}${NBSP}: onglet ${describe(tab)} (${Math.round(rect.height)} px de haut, haut ${Math.round(rect.top)}) ` +
              `différent de ${describe(reference.tab)} (${Math.round(reference.rect.height)} px, haut ${Math.round(reference.rect.top)})`,
          );
          break;
        }
      }
    }
    return problems;
  }, options);
}
