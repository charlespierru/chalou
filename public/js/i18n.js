/* Bascule FR|EN.
 *
 * Le principe : le français est écrit en clair dans le HTML. Au chargement, on
 * en prend un instantané. Passer en anglais remplace les textes marqués ;
 * revenir au français restaure l'instantané. Rien n'est traduit deux fois, et
 * sans JavaScript la page reste entièrement lisible en français.
 */

import en from './en.js';

const DICTS = { en };
const STORAGE_KEY = 'chalou.lang';

/** Instantané du français, pris avant toute modification. */
const original = new Map();

/* Trois façons d'écrire un texte, selon le marquage de l'élément :
 *   data-i18n-attr="alt"  → on écrit dans cet attribut ;
 *   data-i18n-html        → le texte contient du balisage (gras, italique),
 *                           écrit par nous et par personne d'autre ;
 *   sinon                 → texte simple.
 * Sans le cas « html », basculer en anglais effacerait les mots en gras.
 */
function lire(el) {
  if (el.dataset.i18nAttr) return el.getAttribute(el.dataset.i18nAttr);
  if ('i18nHtml' in el.dataset) return el.innerHTML;
  return el.textContent;
}

function ecrire(el, valeur) {
  if (el.dataset.i18nAttr) el.setAttribute(el.dataset.i18nAttr, valeur);
  else if ('i18nHtml' in el.dataset) el.innerHTML = valeur;
  else el.textContent = valeur;
}

function snapshot() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    original.set(el, lire(el));
  }
}

function apply(lang) {
  const dict = DICTS[lang];

  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    // Pas de dictionnaire (français) ou clé absente : on remet l'original.
    const value = dict && key in dict ? dict[key] : original.get(el);
    if (value == null) continue;
    ecrire(el, value);
  }

  document.documentElement.lang = lang;

  // Le titre et la description ne sont pas des nœuds de texte ordinaires.
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = title.textContent;
  const desc = document.querySelector('meta[name="description"][data-i18n]');
  if (desc) {
    const key = desc.dataset.i18n;
    desc.content = dict && key in dict ? dict[key] : original.get(desc) ?? desc.content;
  }

  for (const btn of document.querySelectorAll('.locale-btn')) {
    const on = btn.dataset.lang === lang;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  }
}

function remember(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* navigation privée */ }
}

function recall() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function initial() {
  const stored = recall();
  if (stored === 'fr' || stored === 'en') return stored;
  const url = new URLSearchParams(location.search).get('lang');
  if (url === 'fr' || url === 'en') return url;
  return (navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

snapshot();

// La description est un cas à part : son texte vit dans un attribut.
const descEl = document.querySelector('meta[name="description"][data-i18n]');
if (descEl) original.set(descEl, descEl.content);

for (const btn of document.querySelectorAll('.locale-btn')) {
  btn.addEventListener('click', () => {
    const lang = btn.dataset.lang;
    apply(lang);
    remember(lang);
  });
}

apply(initial());
