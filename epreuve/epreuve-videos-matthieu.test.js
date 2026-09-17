/* ÉPREUVE INDÉPENDANTE — dépôt de vidéos pour Matthieu (page privée + scripts).
 *
 * PLACE DE CE FICHIER. Le mandat demandait `epreuve/epreuve-videos-matthieu.test.js`,
 * qui est la convention de ce dépôt. Le portier d'écriture de l'agent épreuvier
 * n'ouvre qu'un seul chemin — `infra/<domaine>/tests/epreuve-…` — et a refusé
 * l'autre. Le fichier est donc écrit ici SANS RIEN CONTOURNER ; il se trouve
 * lui-même la racine du dépôt (voir `trouverRacine`), donc il marchera aussi
 * bien une fois déplacé dans `epreuve/` :
 *     mv infra/videos-matthieu/tests/epreuve-videos-matthieu.test.js epreuve/
 *     node --test epreuve/epreuve-videos-matthieu.test.js
 *
 * Écrite à partir du BUT et des INTERDITS SEULEMENT. N'ont été ouverts NI
 * `deploy/videos-page.sh` (qui existait déjà au moment de l'écriture), NI
 * `deploy/videos-deposer.sh`, NI `deploy/videos-retirer.sh`, NI le plan
 * `docs/videos-matthieu-plan.md`. Seuls ont été relevés : la forme des épreuves
 * existantes (epreuve-contact.test.js, epreuve-webhook-fadebeat.test.js) et
 * l'INTERFACE donnée dans le mandat (noms des réglages, artifices de banc).
 *
 * CE QUE CETTE ÉPREUVE CHERCHE À METTRE EN ÉCHEC, par ordre de gravité :
 *   1. un script qui dit « déposé, vérifié » alors que rien n'est vérifié
 *      (ou que la page est publique, ou que la copie a échoué) : faute
 *      SILENCIEUSE, la pire ;
 *   2. une page qui MENT : un fichier listé qui n'existe pas, une vidéo
 *      oubliée, un lien qui casse sur un nom retors, un nom mal échappé qui
 *      injecte du HTML ;
 *   3. un script qui touche au réseau avant de refuser ;
 *   4. un script qui refuse à tort (les TÉMOINS, sans lesquels on rendrait
 *      l'outil muet en croyant le rendre sûr).
 *
 * LE BANC, ET SES ARTIFICES (dits franchement, tous locaux, aucun réseau) :
 *  1. FAUX SERVEUR DISTANT. `VIDEOS_DISTANT_CMD` pointe sur un exécutable du
 *     bac qui (a) journalise chaque appel, (b) exécute la commande reçue dans
 *     `<bac>/faux-serveur` après avoir préfixé de ce dossier tout chemin
 *     absolu commençant par /home /srv /var /opt /data /root /mnt /media /tmp
 *     /www /public_html, (c) REFUSE toute commande destructrice visant un
 *     chemin hors du bac, et (d) refuse tout ssh/scp/rsync/sftp imbriqué et
 *     tout curl/wget qui ne vise pas 127.0.0.1. C'est un artifice : un script
 *     qui utiliserait un chemin distant d'une autre forme (par ex. sous /usr)
 *     verrait sa commande s'exécuter hors du faux serveur, et l'épreuve le
 *     dirait mal.
 *  2. FAUSSE COPIE. `VIDEOS_COPIE_CMD` pointe sur un exécutable du bac qui
 *     journalise, ignore les options (-…), prend le dernier argument comme
 *     destination (en retirant un éventuel préfixe « hôte: ») et copie
 *     réellement. Il REFUSE toute source de plus de 200 Mio (garde-fou du
 *     banc, voir le cas E2).
 *  3. FAUX HÔTE WEB. `VIDEOS_HOTE_WEB` pointe sur un petit serveur HTTP Node
 *     lancé par l'épreuve, en http:// (pas https://) sur 127.0.0.1. Il rend
 *     401 sans en-tête Authorization, 200 (ou 206 si Range) avec les bons
 *     identifiants, 404 pour un fichier absent du faux serveur. Il sait jouer
 *     des rôles : `ouvert` (200 sans identifiants), `refuse` (401 toujours),
 *     `panne` (500), `absent` (404), `fantome` (200 même pour un fichier
 *     supprimé). Un fichier demandé est cherché PAR SON NOM dans tout le faux
 *     serveur : l'épreuve n'a pas à connaître l'arborescence distante.
 *  4. FAUX `df`. L'espace libre d'un serveur ne se fabrique pas : un `df` de
 *     banc est placé en tête de PATH et rend l'espace écrit dans
 *     `<bac>/espace-libre`. Un script qui mesurerait l'espace autrement que
 *     par `df` (par ex. `stat -f`) ne serait pas mesuré ici — l'épreuve le dit
 *     alors dans son message d'échec (le journal du faux df est resté vide).
 *  5. GARDE-FOUS DE SORTIE. `ssh`, `scp`, `sftp`, `rsync`, `sshpass` sont
 *     remplacés en tête de PATH par des leurres qui journalisent et échouent :
 *     si un script ignore VIDEOS_DISTANT_CMD, il ne joint personne et
 *     l'épreuve le voit (cas L1). http_proxy/https_proxy pointent sur un port
 *     mort et no_proxy n'autorise que 127.0.0.1 : une requête vers
 *     chalou.link ne sort pas de la machine.
 *  6. FICHIER CREUX. Le cas E2 a besoin d'un fichier de 3 Gio ; il est CREUX
 *     (sparse). Un script qui mesure la taille apparente (stat, ls, du -b,
 *     wc -c) le voit à 3 Gio ; un script qui mesurerait l'occupation disque
 *     (du sans -b) le verrait à zéro. Artifice assumé, pour ne pas écrire
 *     3 Gio à chaque exécution.
 *  7. Les secrets du banc sont jetables, tirés au hasard à chaque exécution,
 *     et effacés à la fin.
 *
 * Trois interdits du RETRAIT (R5, R6, R7) vivent dans la section TÉMOINS :
 * ils ont besoin d'un serveur déjà garni par les dépôts nominaux.
 *
 * Aucun réseau, aucun secret réel, rien hors de `epreuve/bac/videos-<COURSE>/`.
 *
 * Lancement : node --test <ce fichier>
 * Réglages facultatifs : EPREUVE_RACINE (racine du projet), EPREUVE_BAC.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────  le banc  ───────────────────────── */

/* La racine du dépôt est cherchée en remontant : le fichier marche depuis
 * `epreuve/` comme depuis `infra/<domaine>/tests/`. */
function trouverRacine(depart) {
  let d = depart;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(d, 'deploy')) && fs.existsSync(path.join(d, 'package.json'))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return depart;
}

const RACINE = process.env.EPREUVE_RACINE
  ? path.resolve(process.env.EPREUVE_RACINE)
  : trouverRacine(fileURLToPath(new URL('./', import.meta.url)));
const COURSE = Math.random().toString(36).slice(2, 7).toUpperCase();
const BAC = path.join(process.env.EPREUVE_BAC ?? path.join(RACINE, 'epreuve/bac'), `videos-${COURSE}`);

const FAUXROOT = path.join(BAC, 'faux-serveur');
const SHIMS = path.join(BAC, 'leurres');
const HOME_BANC = path.join(BAC, 'home');
const SOURCES = path.join(BAC, 'sources');
const PAGES = path.join(BAC, 'pages');
const CHEMIN_SECRETS = path.join(BAC, 'secrets', 'videos-matthieu.env');
const SECRETS_DEFAUT = path.join(HOME_BANC, '.config', 'chalou', 'videos-matthieu.env');

const JOURNAL_DISTANT = path.join(BAC, 'journal-distant.log');
const JOURNAL_COPIE = path.join(BAC, 'journal-copie.log');
const JOURNAL_DF = path.join(BAC, 'journal-df.log');
const JOURNAL_INTERDIT = path.join(BAC, 'journal-interdit.log');
const MODE_DISTANT = path.join(BAC, 'mode-distant');
const MODE_COPIE = path.join(BAC, 'mode-copie');
const ESPACE_LIBRE = path.join(BAC, 'espace-libre');

const FAUX_DISTANT = path.join(BAC, 'faux-distant');
const FAUX_COPIE = path.join(BAC, 'faux-copie');

const SCRIPT_PAGE = path.join(RACINE, 'deploy', 'videos-page.sh');
const SCRIPT_DEPOSER = path.join(RACINE, 'deploy', 'videos-deposer.sh');
const SCRIPT_RETIRER = path.join(RACINE, 'deploy', 'videos-retirer.sh');

const SEGMENT = `prive-${randomBytes(6).toString('hex')}`;
const UTILISATEUR = `matthieu-${COURSE.toLowerCase()}`;
/* SECRET-EN-ARGUMENT-CITE: mot de passe JETABLE du banc, tiré au hasard, jamais réel. */
const MOT_DE_PASSE = `mdp-banc-${randomBytes(12).toString('hex')}`;

const EXT_VIDEO = /\.(mp4|mov|webm|mkv|m4v)$/i;
const GIO = 1024 ** 3;
const ESPACE_CONFORTABLE = String(500 * GIO);

let PORT_WEB = 0;
let PORT_MORT = 0;
let hote = null;

/* ────────────────────────  petits outils  ──────────────────────── */

function portOccupe(port) {
  return new Promise((r) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); r(true); });
    s.on('error', () => r(false));
    setTimeout(() => { s.destroy(); r(false); }, 800);
  });
}
async function portLibre(base) {
  for (let p = base; p < base + 120; p++) if (!(await portOccupe(p))) return p;
  throw new Error('aucun port libre');
}

const compterLignes = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length; } catch { return 0; } };
const lireJournal = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

function arborescence(racine) {
  const out = [];
  const marcher = (d, prefixe) => {
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entrees.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const complet = path.join(d, e.name);
      const rel = prefixe ? `${prefixe}/${e.name}` : e.name;
      if (e.isDirectory()) marcher(complet, rel);
      else { let t = -1; try { t = fs.statSync(complet).size; } catch { /* rien */ } out.push(`${rel}:${t}`); }
    }
  };
  marcher(racine, '');
  return out;
}

const etatFauxServeur = () => arborescence(FAUXROOT);

function videosDistantes() {
  return etatFauxServeur()
    .map((l) => l.slice(0, l.lastIndexOf(':')))
    .map((p) => p.split('/').pop())
    .filter((n) => EXT_VIDEO.test(n))
    .sort();
}

/* Le fichier HTML le plus récemment écrit sur le faux serveur : la page distante. */
function pageDistante() {
  const candidats = [];
  const marcher = (d) => {
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      const complet = path.join(d, e.name);
      if (e.isDirectory()) marcher(complet);
      else if (/\.html?$/i.test(e.name)) candidats.push(complet);
    }
  };
  marcher(FAUXROOT);
  if (!candidats.length) return null;
  candidats.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return { chemin: candidats[0], html: fs.readFileSync(candidats[0], 'utf8') };
}

/* ─────────────────────  fabrication des fichiers  ───────────────────── */

function enteteVideo(nom) {
  const ext = (nom.match(EXT_VIDEO) ?? [''])[0].toLowerCase();
  if (ext === '.mkv' || ext === '.webm') return Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
  const marque = ext === '.mov' ? 'qt  ' : ext === '.m4v' ? 'M4V ' : 'isom';
  return Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from(`ftyp${marque}`),
    Buffer.from([0, 0, 2, 0]),
    Buffer.from('isomiso2avc1mp41'),
  ]);
}

/* Une vidéo de banc : en-tête plausible + remplissage qui dépend du nom
 * (chaque fichier a donc un contenu unique, vérifiable de bout en bout). */
function fabriquerVideo(chemin, taille = 4096, quand = null) {
  const tete = enteteVideo(chemin);
  const graine = Buffer.from(`${path.basename(chemin)}|${COURSE}|`.repeat(64));
  const reste = Math.max(0, taille - tete.length);
  const corps = Buffer.alloc(reste);
  for (let i = 0; i < reste; i++) corps[i] = graine[i % graine.length];
  fs.writeFileSync(chemin, Buffer.concat([tete, corps]));
  if (quand) fs.utimesSync(chemin, quand, quand);
  return chemin;
}

function dossierDePage(nom, fichiers = []) {
  const d = path.join(PAGES, nom);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  for (const f of fichiers) {
    const complet = path.join(d, f.nom);
    if (f.type === 'dossier') { fs.mkdirSync(complet, { recursive: true }); continue; }
    if (f.type === 'lien-mort') { fs.symlinkSync(path.join(d, `cible-inexistante-${COURSE}`), complet); continue; }
    if (f.type === 'texte') {
      fs.writeFileSync(complet, f.contenu ?? `pas une vidéo — ${f.nom}\n`);
      if (f.date) fs.utimesSync(complet, f.date, f.date);
      continue;
    }
    fabriquerVideo(complet, f.taille ?? 4096, f.date ?? null);
  }
  return d;
}

/* ───────────────────  lancer un script sous épreuve  ─────────────────── */

const enfants = [];
process.on('exit', () => { for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* rien */ } } });

function envBanc(extra = {}, retirer = []) {
  const env = {
    PATH: `${SHIMS}:${process.env.PATH}`,
    HOME: HOME_BANC,
    LANG: process.env.LANG ?? 'C.UTF-8',
    TERM: 'dumb',
    TMPDIR: path.join(BAC, 'tmp'),
    VIDEOS_SECRETS: CHEMIN_SECRETS,
    VIDEOS_DISTANT_CMD: FAUX_DISTANT,
    VIDEOS_COPIE_CMD: FAUX_COPIE,
    VIDEOS_HOTE_WEB: `http://127.0.0.1:${PORT_WEB}`,
    http_proxy: `http://127.0.0.1:${PORT_MORT}`,
    https_proxy: `http://127.0.0.1:${PORT_MORT}`,
    no_proxy: '127.0.0.1,localhost',
    ...extra,
  };
  for (const k of retirer) delete env[k];
  return env;
}

function lancer(script, args, opts = {}) {
  const relatif = path.relative(RACINE, script);
  if (!fs.existsSync(script)) {
    return Promise.resolve({ absent: true, code: null, sortie: '', err: '', bloque: false, ms: 0, script: relatif });
  }
  let cmd = script;
  let argv = args;
  try { fs.accessSync(script, fs.constants.X_OK); } catch { cmd = 'bash'; argv = [script, ...args]; }
  return new Promise((resolve) => {
    const debut = Date.now();
    let bloque = false;
    const proc = spawn(cmd, argv, {
      cwd: opts.cwd ?? RACINE,
      env: envBanc(opts.env ?? {}, opts.sansEnv ?? []),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    enfants.push(proc);
    let sortie = '';
    let err = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { sortie += d; });
    proc.stderr.on('data', (d) => { err += d; });
    const minuteur = setTimeout(() => { bloque = true; try { proc.kill('SIGKILL'); } catch { /* rien */ } }, opts.delaiMs ?? 30000);
    proc.on('error', (e) => {
      clearTimeout(minuteur);
      resolve({ absent: false, code: null, sortie, err: `${err}\n${e.message}`, bloque, ms: Date.now() - debut, script: relatif });
    });
    proc.on('close', (code, signal) => {
      clearTimeout(minuteur);
      resolve({ absent: false, code, signal, sortie, err, bloque, ms: Date.now() - debut, script: relatif });
    });
  });
}

const apercu = (r) => `${r.sortie}\n${r.err}`.trim().replace(/\s+/g, ' ').slice(0, 500);

function exigerPresent(r) {
  assert.ok(!r.absent, `LE SCRIPT ${r.script} N'EXISTE PAS — rien ne peut être jugé, et un script absent ne doit JAMAIS ressembler à un succès`);
}
function assertRefus(r, contexte) {
  exigerPresent(r);
  assert.equal(r.bloque, false, `${contexte} : le script ne rend jamais la main (tué au bout de ${r.ms} ms) — bloqué, donc muet`);
  assert.notEqual(r.code, 0, `${contexte} : le script a ACCEPTÉ (code 0) ce qu'il doit refuser. Sortie : ${apercu(r)}`);
  assert.notEqual(r.code, null, `${contexte} : le script est mort sur un signal (${r.signal}) sans code de sortie lisible`);
  assert.notEqual(`${r.sortie}${r.err}`.trim(), '', `${contexte} : refus MUET — aucun message lisible pour Charles`);
}
function assertSucces(r, contexte) {
  exigerPresent(r);
  assert.equal(r.bloque, false, `${contexte} : le script ne rend jamais la main (tué au bout de ${r.ms} ms)`);
  assert.equal(r.code, 0, `${contexte} : le script a échoué (code ${r.code}) alors qu'il devait aboutir. Sortie : ${apercu(r)}`);
}

/* ──────────────────  l'état du « réseau » du banc  ────────────────── */

function etatReseau() {
  return {
    distant: compterLignes(JOURNAL_DISTANT),
    copie: compterLignes(JOURNAL_COPIE),
    interdit: compterLignes(JOURNAL_INTERDIT),
    http: hote ? hote.journal.length : 0,
    serveur: etatFauxServeur(),
  };
}
function verifierReseauIntact(avant, contexte) {
  const apres = etatReseau();
  assert.equal(apres.distant, avant.distant, `${contexte} : le script a lancé une commande DISTANTE avant de refuser :\n${lireJournal(JOURNAL_DISTANT).split('\n').slice(-3).join('\n')}`);
  assert.equal(apres.copie, avant.copie, `${contexte} : le script a lancé une COPIE avant de refuser :\n${lireJournal(JOURNAL_COPIE).split('\n').slice(-3).join('\n')}`);
  assert.equal(apres.http, avant.http, `${contexte} : le script a interrogé l'hôte web avant de refuser`);
  assert.equal(apres.interdit, 0, `${contexte} : le script a tenté une VRAIE commande distante (ssh/scp/rsync) :\n${lireJournal(JOURNAL_INTERDIT)}`);
  assert.deepEqual(apres.serveur, avant.serveur, `${contexte} : le contenu du faux serveur a changé alors que le script devait refuser`);
}

/* ────────────────────────  lecture de la page  ──────────────────────── */

function deshtml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}
const aplati = (s) => s.replace(/ | /g, ' ').replace(/\s+/g, ' ').trim();

function texteDe(html) {
  return aplati(deshtml(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' '),
  ));
}

function hrefsDe(html) {
  const out = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

function decoderLien(brut) {
  const url = deshtml(brut);
  const dernier = url.split('/').pop() ?? '';
  let valide = true;
  let raison = '';
  if (/[ "<>\\^`{}|]/.test(url)) { valide = false; raison = 'caractère brut interdit dans une URL (espace, guillemet, chevron…)'; }
  else if (/[#?]/.test(url)) { valide = false; raison = '« # » ou « ? » non encodé : le navigateur coupe le lien à cet endroit'; }
  else if (/%(?![0-9a-fA-F]{2})/.test(url)) { valide = false; raison = '« % » non encodé (%25 attendu)'; }
  let decode = null;
  try { decode = decodeURIComponent(dernier); } catch { valide = false; raison = 'séquence %xx invalide'; }
  return { brut, url, dernier, decode, valide, raison };
}

/* Ce que le dossier contient vraiment : vidéos d'un côté, tout le reste de l'autre. */
function contenuVrai(dossier) {
  const entrees = fs.readdirSync(dossier, { withFileTypes: true });
  const videos = [];
  const autres = [];
  for (const e of entrees) {
    const complet = path.join(dossier, e.name);
    const estFichier = e.isFile() || (e.isSymbolicLink() && fs.existsSync(complet));
    if (estFichier && EXT_VIDEO.test(e.name)) videos.push(e.name);
    else autres.push(e.name);
  }
  return { videos: videos.sort(), autres: autres.sort() };
}

function verifierPageSaine(html, contexte) {
  assert.ok(html && html.trim() !== '', `${contexte} : la page produite est VIDE`);
  assert.ok(/<!doctype\s+html/i.test(html), `${contexte} : pas de <!doctype html> — ce n'est pas une page HTML complète`);
  assert.ok(/<html[\s>]/i.test(html), `${contexte} : pas de balise <html>`);
  assert.ok(/<\/html>/i.test(html), `${contexte} : la page n'est pas fermée (</html> manquant) — page tronquée ?`);
  assert.ok(/<meta[^>]*charset\s*=\s*["']?\s*utf-?8/i.test(html), `${contexte} : aucun charset utf-8 déclaré — les noms accentués s'afficheront de travers`);

  const robots = (html.match(/<meta[^>]*>/gi) ?? []).filter((m) => /name\s*=\s*["']?robots/i.test(m));
  assert.ok(robots.length > 0, `${contexte} : aucune balise <meta name="robots"> — la page n'est pas muette pour les moteurs de recherche`);
  assert.ok(robots.some((m) => /noindex/i.test(m)), `${contexte} : la balise robots ne dit pas noindex : ${robots.join(' ')}`);

  assert.ok(!/<style[\s>]/i.test(html), `${contexte} : bloc <style> EN LIGNE dans la page — la politique de sécurité du site l'interdit`);
  const attributsStyle = html.match(/<[a-z][^>]*\sstyle\s*=\s*["'][^"']*["'][^>]*>/gi) ?? [];
  assert.deepEqual(attributsStyle, [], `${contexte} : attribut style="…" EN LIGNE — interdit par la politique de sécurité : ${attributsStyle.slice(0, 2).join(' ')}`);
  for (const bloc of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
    const dedans = bloc.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
    assert.equal(dedans.trim(), '', `${contexte} : script EN LIGNE dans la page — interdit par la politique de sécurité : ${bloc.slice(0, 160)}`);
  }
  for (const balise of html.match(/<[a-z][^>]*>/gi) ?? []) {
    assert.ok(!/\son[a-z]+\s*=/i.test(balise), `${contexte} : gestionnaire d'événement en ligne (onclick, onerror…) : ${balise.slice(0, 160)}`);
  }
  assert.ok(!/javascript\s*:/i.test(html), `${contexte} : une URL « javascript: » traîne dans la page`);
  assert.ok(!html.includes(MOT_DE_PASSE), `${contexte} : le MOT DE PASSE est écrit dans la page`);
}

/* Fenêtre de lecture autour d'un nom : de ce nom jusqu'au nom suivant. */
function fenetreAutour(texte, nom, tousLesNoms) {
  const cible = aplati(nom);
  const debut = texte.indexOf(cible);
  if (debut < 0) return null;
  let fin = Math.min(texte.length, debut + cible.length + 400);
  for (const autre of tousLesNoms) {
    if (autre === nom) continue;
    const p = texte.indexOf(aplati(autre), debut + cible.length);
    if (p >= 0 && p < fin) fin = p;
  }
  const avant = Math.max(0, debut - 120);
  return texte.slice(avant, fin);
}

const FACTEURS = {
  o: [1], octet: [1], octets: [1], b: [1], byte: [1], bytes: [1],
  k: [1000, 1024], ko: [1000, 1024], kb: [1000, 1024], kio: [1024], kib: [1024],
  m: [1e6, 1024 ** 2], mo: [1e6, 1024 ** 2], mb: [1e6, 1024 ** 2], mio: [1024 ** 2], mib: [1024 ** 2],
  g: [1e9, GIO], go: [1e9, GIO], gb: [1e9, GIO], gio: [GIO], gib: [GIO],
  t: [1e12, 1024 ** 4], to: [1e12, 1024 ** 4], tb: [1e12, 1024 ** 4], tio: [1024 ** 4], tib: [1024 ** 4],
};

/* Une taille lisible : « 40,0 Ko », « 1 234 567 octets », « 1.2 MiB »…
 * Le nombre ne doit pas commencer collé à une lettre (sinon le « 4 » de
 * « .mp4 » se lit comme un chiffre : faute de CETTE épreuve, trouvée au
 * premier lancement, le 2026-09-16), et l'unité ne doit pas être le début
 * d'un mot (« 12:00 Télécharger » n'est pas « 00 Tio »). */
function tailleAffichee(fenetre, octets) {
  const trouvees = [];
  const re = /(?<![\p{L}\d.,])(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(octets?|bytes?|kio|kib|mio|mib|gio|gib|tio|tib|ko|kb|mo|mb|go|gb|to|tb|o|b|k|m|g|t)(?![\p{L}])/giu;
  let m;
  while ((m = re.exec(fenetre)) !== null) {
    const nombre = parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.'));
    if (!Number.isFinite(nombre)) continue;
    for (const f of FACTEURS[m[2].toLowerCase()] ?? []) trouvees.push({ texte: m[0], valeur: nombre * f });
  }
  for (const brut of fenetre.match(/\b\d{3,}\b/g) ?? []) trouvees.push({ texte: brut, valeur: Number(brut) });
  const marge = octets * 0.07 + 1;
  return { trouvees, juste: trouvees.some((t) => Math.abs(t.valeur - octets) <= marge) };
}

function datesPossibles(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  const A = d.getFullYear();
  const M = d.getMonth() + 1;
  const J = d.getDate();
  const fr = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const frAbr = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  const en = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const enAbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  return [
    `${A}-${p2(M)}-${p2(J)}`, `${p2(J)}/${p2(M)}/${A}`, `${J}/${M}/${A}`, `${p2(J)}-${p2(M)}-${A}`,
    `${A}/${p2(M)}/${p2(J)}`, `${p2(J)}.${p2(M)}.${A}`, `${A}${p2(M)}${p2(J)}`,
    `${J} ${fr[M - 1]} ${A}`, `${p2(J)} ${fr[M - 1]} ${A}`, `${J} ${frAbr[M - 1]}`, `${p2(J)} ${frAbr[M - 1]}`,
    `${en[M - 1]} ${J}, ${A}`, `${en[M - 1]} ${p2(J)}`, `${enAbr[M - 1]} ${J}`, `${enAbr[M - 1]} ${p2(J)}`,
    `${p2(J)} ${enAbr[M - 1]} ${A}`,
  ];
}

/* La page dit-elle la vérité sur ce dossier ? */
function verifierPageVraie(html, dossier, contexte, opts = {}) {
  const { videos, autres } = contenuVrai(dossier);
  const liens = hrefsDe(html).map(decoderLien);
  const liensVideo = liens.filter((l) => l.decode !== null && EXT_VIDEO.test(l.decode));

  for (const l of liensVideo) {
    assert.ok(l.valide, `${contexte} : lien mal formé (${l.raison}) — href brut : ${l.brut}`);
  }
  const nomsLies = liensVideo.map((l) => l.decode).sort();
  assert.deepEqual([...new Set(nomsLies)].sort(), videos,
    `${contexte} : la page ne liste pas EXACTEMENT les vidéos du dossier.\n  liées : ${JSON.stringify(nomsLies)}\n  présentes : ${JSON.stringify(videos)}`);
  assert.equal(nomsLies.length, videos.length, `${contexte} : une vidéo est liée plusieurs fois : ${JSON.stringify(nomsLies)}`);

  for (const l of liens) {
    if (l.decode !== null && autres.includes(l.decode)) {
      assert.fail(`${contexte} : la page propose « ${l.decode} », qui n'est pas une vidéo du dossier`);
    }
  }

  const texte = texteDe(html);
  for (const nom of videos) {
    assert.ok(texte.includes(aplati(nom)), `${contexte} : le nom « ${nom} » n'apparaît nulle part en texte lisible (mal échappé, tronqué, ou absent).\n  texte de la page : ${texte.slice(0, 400)}`);
  }
  if (opts.sansTailleNiDate) return;
  for (const nom of videos) {
    const st = fs.statSync(path.join(dossier, nom));
    const fenetre = fenetreAutour(texte, nom, videos);
    assert.ok(fenetre, `${contexte} : nom « ${nom} » introuvable dans le texte`);
    const t = tailleAffichee(fenetre, st.size);
    assert.ok(t.juste, `${contexte} : aucune taille correspondant à « ${nom} » (${st.size} octets) près de son nom.\n  lu : ${JSON.stringify(t.trouvees.map((x) => x.texte))}\n  fenêtre : ${fenetre.slice(0, 240)}`);
    const dates = datesPossibles(st.mtime);
    const basse = fenetre.toLowerCase();
    assert.ok(dates.some((d) => basse.includes(d.toLowerCase())),
      `${contexte} : aucune date lisible pour « ${nom} » (modifié le ${st.mtime.toISOString()}) près de son nom.\n  fenêtre : ${fenetre.slice(0, 240)}`);
  }
}

/* ────────────────  demander quelque chose au faux hôte web  ──────────────── */

function demander(cheminUrl, opts = {}) {
  const entetes = {};
  if (opts.auth !== false) entetes.authorization = `Basic ${Buffer.from(`${UTILISATEUR}:${MOT_DE_PASSE}`).toString('base64')}`;
  if (opts.range) entetes.range = opts.range;
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT_WEB, path: cheminUrl, method: opts.methode ?? 'GET', headers: entetes }, (rep) => {
      const morceaux = [];
      rep.on('data', (c) => morceaux.push(c));
      rep.on('end', () => resolve({ statut: rep.statusCode, corps: Buffer.concat(morceaux), entetes: rep.headers }));
    });
    req.on('error', (e) => resolve({ statut: 0, corps: Buffer.alloc(0), erreur: e.message }));
    req.end();
  });
}

/* Le chemin d'URL d'un href de la page, tel qu'un navigateur le demanderait. */
function urlDuLien(href) {
  const base = `http://127.0.0.1:${PORT_WEB}/${SEGMENT}/`;
  const u = new URL(deshtml(href), base);
  return u.pathname + u.search;
}

/* ─────────────────────────  le faux hôte web  ───────────────────────── */

function chercherParNom(nom) {
  let trouve = null;
  const marcher = (d) => {
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      if (trouve) return;
      const complet = path.join(d, e.name);
      if (e.isDirectory()) marcher(complet);
      else if (e.name === nom) trouve = complet;
    }
  };
  marcher(FAUXROOT);
  return trouve;
}

async function demarrerFauxHote(port) {
  const journal = [];
  let mode = 'normal';
  const attendu = `Basic ${Buffer.from(`${UTILISATEUR}:${MOT_DE_PASSE}`).toString('base64')}`;

  const srv = http.createServer((req, res) => {
    const entete = req.headers.authorization ?? null;
    const aAuth = entete !== null;
    const authOk = entete === attendu;
    const chemin = req.url ?? '/';
    let dernier = '';
    try { dernier = decodeURIComponent(chemin.split('?')[0].split('/').pop() ?? ''); } catch { dernier = chemin.split('/').pop() ?? ''; }
    const note = (statut, quoi) => { journal.push({ date: Date.now(), url: chemin, nom: dernier, methode: req.method, aAuth, authOk, statut, quoi, mode }); return statut; };
    const finir = (statut, corps = Buffer.alloc(0), entetes = {}) => {
      res.writeHead(statut, { 'content-type': 'application/octet-stream', ...entetes });
      if (req.method === 'HEAD') res.end(); else res.end(corps);
    };

    if (mode === 'panne') { finir(note(aAuth && authOk ? 500 : 401, 'panne'), Buffer.from('panne du banc')); return; }
    if (mode === 'refuse') { finir(note(401, 'refuse'), Buffer.alloc(0), { 'www-authenticate': 'Basic realm="videos"' }); return; }
    if (mode !== 'ouvert' && !aAuth) { finir(note(401, 'sans identifiants'), Buffer.alloc(0), { 'www-authenticate': 'Basic realm="videos"' }); return; }
    if (mode !== 'ouvert' && !authOk) { finir(note(401, 'mauvais identifiants'), Buffer.alloc(0), { 'www-authenticate': 'Basic realm="videos"' }); return; }
    if (mode === 'absent') { finir(note(404, 'absent'), Buffer.from('404')); return; }
    if (mode === 'fantome') { finir(note(200, 'fantôme'), Buffer.from('fantôme du banc')); return; }

    /* La page elle-même, ou un fichier cherché par son nom dans le faux serveur. */
    let fichier = null;
    if (dernier === '' || dernier === SEGMENT || /\.html?$/i.test(dernier)) {
      const p = pageDistante();
      fichier = p ? p.chemin : null;
    } else {
      fichier = chercherParNom(dernier);
    }
    if (!fichier) { finir(note(404, 'introuvable'), Buffer.from('404')); return; }
    const contenu = fs.readFileSync(fichier);
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const debut = m ? Number(m[1]) : 0;
      const fin = m && m[2] !== '' ? Math.min(Number(m[2]), contenu.length - 1) : contenu.length - 1;
      const tranche = contenu.subarray(debut, fin + 1);
      finir(note(206, 'tranche'), tranche, { 'content-range': `bytes ${debut}-${fin}/${contenu.length}`, 'content-length': String(tranche.length) });
      return;
    }
    finir(note(200, 'fichier'), contenu, { 'content-length': String(contenu.length) });
  });

  await new Promise((ok, ko) => { srv.once('error', ko); srv.listen(port, '127.0.0.1', () => { srv.off('error', ko); ok(); }); });
  return {
    journal,
    port,
    role: (m) => { mode = m; },
    depuis: (t) => journal.filter((j) => j.date >= t),
    arreter: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }),
    relancer: () => new Promise((ok, ko) => { srv.once('error', ko); srv.listen(port, '127.0.0.1', () => { srv.off('error', ko); ok(); }); }),
    fermer: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }),
  };
}

/* ───────────────────  les faux outils du banc (écrits ici)  ─────────────────── */

function ecrireBanc() {
  const J = (v) => JSON.stringify(v);

  const fauxDistant = `'use strict';
/* Faux serveur distant du banc d'épreuve — voir l'en-tête de l'épreuve. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const BAC = ${J(BAC)};
const FAUXROOT = ${J(FAUXROOT)};
const SHIMS = ${J(SHIMS)};
const JOURNAL = ${J(JOURNAL_DISTANT)};
const INTERDIT = ${J(JOURNAL_INTERDIT)};
const args = process.argv.slice(2);
const commande = args.join(' ');
const note = (o) => { try { fs.appendFileSync(JOURNAL, JSON.stringify(o) + '\\n'); } catch (e) {} };
note({ type: 'appel', date: Date.now(), args: args });
let mode = 'normal';
try { mode = (fs.readFileSync(path.join(BAC, 'mode-distant'), 'utf8').trim() || 'normal'); } catch (e) {}
if (mode === 'panne') {
  process.stderr.write('faux-distant : le serveur ne repond pas (mode panne du banc)\\n');
  note({ type: 'fin', code: 255, mode: 'panne' });
  process.exit(255);
}
if (commande.trim() === '') { note({ type: 'fin', code: 0, vide: true }); process.exit(0); }
if (/(^|[^a-zA-Z0-9_-])(ssh|scp|sftp|rsync|sshpass)([^a-zA-Z0-9_-]|$)/.test(commande)) {
  try { fs.appendFileSync(INTERDIT, 'distant-imbrique ' + commande + '\\n'); } catch (e) {}
  process.stderr.write('faux-distant : commande distante imbriquee interdite sur le banc\\n');
  note({ type: 'fin', code: 98, hors: 'ssh' });
  process.exit(98);
}
if (/(curl|wget)/.test(commande) && !/127\\.0\\.0\\.1|localhost/.test(commande)) {
  try { fs.appendFileSync(INTERDIT, 'sortie-http ' + commande + '\\n'); } catch (e) {}
  process.stderr.write('faux-distant : sortie HTTP hors du banc interdite\\n');
  note({ type: 'fin', code: 98, hors: 'http' });
  process.exit(98);
}
const RACINES = '(home|srv|var|opt|data|root|mnt|media|tmp|www|public_html)';
const re = new RegExp('(?<![A-Za-z0-9_.])/' + RACINES + '(/[^\\\\s\\'";|&()<>]*)?', 'g');
const mappee = commande.replace(re, (m) => FAUXROOT + m);
const destructif = /(^|[^a-zA-Z0-9_-])(rm|rmdir|mv|dd|mkfs|shred|truncate|chown|chmod)([^a-zA-Z0-9_-]|$)/.test(mappee);
const cheminsHors = (mappee.match(/(?<![A-Za-z0-9_.])\\/[A-Za-z0-9_.\\-\\/]+/g) || [])
  .filter(function (p) { return p.indexOf(FAUXROOT) !== 0 && !/^\\/(usr|bin|sbin|lib|lib64|proc|dev)/.test(p); });
if (destructif && cheminsHors.length) {
  try { fs.appendFileSync(INTERDIT, 'hors-bac ' + cheminsHors.join(' ') + ' :: ' + commande + '\\n'); } catch (e) {}
  process.stderr.write('faux-distant : REFUS — commande destructrice hors du bac : ' + cheminsHors.join(' ') + '\\n');
  note({ type: 'fin', code: 96, hors: cheminsHors });
  process.exit(96);
}
fs.mkdirSync(path.join(FAUXROOT, 'home'), { recursive: true });
const env = Object.assign({}, process.env, { HOME: path.join(FAUXROOT, 'home'), PATH: SHIMS + ':' + process.env.PATH });
const r = spawnSync('bash', ['-c', mappee], { cwd: FAUXROOT, stdio: 'inherit', env: env });
note({ type: 'fin', date: Date.now(), mappee: mappee, code: r.status });
process.exit(r.status === null ? 255 : r.status);
`;

  const fauxCopie = `'use strict';
/* Fausse copie (remplace rsync) — voir l'en-tête de l'épreuve. */
const fs = require('node:fs');
const path = require('node:path');
const BAC = ${J(BAC)};
const FAUXROOT = ${J(FAUXROOT)};
const JOURNAL = ${J(JOURNAL_COPIE)};
const args = process.argv.slice(2);
const note = (o) => { try { fs.appendFileSync(JOURNAL, JSON.stringify(o) + '\\n'); } catch (e) {} };
note({ type: 'appel', date: Date.now(), args: args });
let mode = 'normal';
try { mode = (fs.readFileSync(path.join(BAC, 'mode-copie'), 'utf8').trim() || 'normal'); } catch (e) {}
if (mode === 'panne') {
  process.stderr.write('faux-copie : la copie a echoue (mode panne du banc)\\n');
  note({ type: 'fin', code: 12, mode: 'panne' });
  process.exit(12);
}
const AVEC_VALEUR = ['-e', '--rsh', '--exclude', '--include', '--timeout', '--bwlimit', '--chmod', '--chown', '--log-file', '--info', '--out-format', '--port'];
const positionnels = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.charAt(0) === '-' && a !== '-') { if (AVEC_VALEUR.indexOf(a) >= 0) i++; continue; }
  positionnels.push(a);
}
if (positionnels.length < 2) {
  process.stderr.write('faux-copie : il faut au moins une source et une destination (recu : ' + JSON.stringify(args) + ')\\n');
  note({ type: 'fin', code: 13 });
  process.exit(13);
}
const RACINES = /^\\/(home|srv|var|opt|data|root|mnt|media|tmp|www|public_html)(\\/|$)/;
const mapper = function (p) {
  if (RACINES.test(p)) return path.join(FAUXROOT, p);
  return path.isAbsolute(p) ? p : path.join(FAUXROOT, p);
};
const brutDest = positionnels.pop();
const sansHote = brutDest.replace(/^[A-Za-z0-9_.@-]+:/, '');
const finitParSlash = /\\/$/.test(sansHote);
const dest = mapper(sansHote);
for (const src of positionnels) {
  let st = null;
  try { st = fs.statSync(src); } catch (e) {
    process.stderr.write('faux-copie : source introuvable : ' + src + '\\n');
    note({ type: 'fin', code: 14, src: src });
    process.exit(14);
  }
  if (st.size > 200 * 1024 * 1024) {
    process.stderr.write('faux-copie : GARDE-FOU DU BANC — source de ' + st.size + ' octets, copie refusee\\n');
    note({ type: 'fin', code: 15, src: src, taille: st.size, garde: 'trop gros' });
    process.exit(15);
  }
}
let versDossier = finitParSlash || positionnels.length > 1;
try { if (fs.statSync(dest).isDirectory()) versDossier = true; } catch (e) {}
if (versDossier) fs.mkdirSync(dest, { recursive: true });
else fs.mkdirSync(path.dirname(dest), { recursive: true });
for (const src of positionnels) {
  const cible = versDossier ? path.join(dest, path.basename(src)) : dest;
  fs.copyFileSync(src, cible);
  note({ type: 'copie', src: src, cible: cible, taille: fs.statSync(cible).size });
}
note({ type: 'fin', code: 0 });
process.exit(0);
`;

  const fauxDf = `'use strict';
/* Faux df — l'espace libre du serveur est celui ecrit dans <bac>/espace-libre. */
const fs = require('node:fs');
const args = process.argv.slice(2);
try { fs.appendFileSync(${J(JOURNAL_DF)}, JSON.stringify({ date: Date.now(), args: args }) + '\\n'); } catch (e) {}
let libre = 500 * 1024 * 1024 * 1024;
try {
  const v = Number(fs.readFileSync(${J(ESPACE_LIBRE)}, 'utf8').trim());
  if (Number.isFinite(v) && v >= 0) libre = v;
} catch (e) {}
const TOTAL = 4 * 1024 * 1024 * 1024 * 1024;
const utilise = Math.max(0, TOTAL - libre);
function taille(s) {
  const m = /^(\\d*)\\s*([KMGT]?)(i?B?)$/i.exec(String(s).trim());
  if (!m) return 1;
  const n = m[1] === '' ? 1 : Number(m[1]);
  const u = (m[2] || '').toUpperCase();
  const f = u === 'K' ? 1024 : u === 'M' ? 1048576 : u === 'G' ? 1073741824 : u === 'T' ? 1099511627776 : 1;
  return n * f;
}
let bloc = 1024;
let humain = false;
let colonnes = null;
for (const a of args) {
  if (a === '-h' || a === '-H' || a === '--human-readable' || a === '--si') humain = true;
  else if (a === '-k') bloc = 1024;
  else if (a === '-m') bloc = 1048576;
  else if (a.indexOf('--block-size=') === 0) bloc = taille(a.slice(13));
  else if (a.indexOf('-B') === 0 && a.length > 2) bloc = taille(a.slice(2));
  else if (a.indexOf('--output=') === 0) colonnes = a.slice(9).split(',');
}
function lisible(v) {
  const u = [[1099511627776, 'T'], [1073741824, 'G'], [1048576, 'M'], [1024, 'K']];
  for (const p of u) if (v >= p[0]) return (v / p[0]).toFixed(1) + p[1];
  return String(v);
}
const rendu = (v) => (humain ? lisible(v) : String(Math.floor(v / bloc)));
const pct = Math.round((utilise / TOTAL) * 100) + '%';
if (colonnes) {
  const titres = { source: 'Filesystem', fstype: 'Type', size: 'Size', used: 'Used', avail: 'Avail', pcent: 'Use%', target: 'Mounted on', file: 'File' };
  const valeurs = { source: '/dev/faux-banc', fstype: 'ext4', size: rendu(TOTAL), used: rendu(utilise), avail: rendu(libre), pcent: pct, target: '/', file: '-' };
  process.stdout.write(colonnes.map((c) => titres[c] || c).join(' ') + '\\n');
  process.stdout.write(colonnes.map((c) => valeurs[c] || '-').join(' ') + '\\n');
} else {
  const entete = humain ? 'Size' : (bloc === 1024 ? '1K-blocks' : bloc + 'B-blocks');
  process.stdout.write('Filesystem ' + entete + ' Used Available Use% Mounted on\\n');
  process.stdout.write('/dev/faux-banc ' + rendu(TOTAL) + ' ' + rendu(utilise) + ' ' + rendu(libre) + ' ' + pct + ' /\\n');
}
process.exit(0);
`;

  fs.mkdirSync(BAC, { recursive: true });
  fs.mkdirSync(SHIMS, { recursive: true });
  fs.mkdirSync(FAUXROOT, { recursive: true });
  fs.mkdirSync(SOURCES, { recursive: true });
  fs.mkdirSync(PAGES, { recursive: true });
  fs.mkdirSync(path.join(BAC, 'tmp'), { recursive: true });
  fs.mkdirSync(path.dirname(CHEMIN_SECRETS), { recursive: true });
  fs.mkdirSync(path.dirname(SECRETS_DEFAUT), { recursive: true });

  fs.writeFileSync(path.join(BAC, 'faux-distant.cjs'), fauxDistant);
  fs.writeFileSync(path.join(BAC, 'faux-copie.cjs'), fauxCopie);
  fs.writeFileSync(path.join(BAC, 'faux-df.cjs'), fauxDf);

  const enveloppe = (cible) => `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cible)} "$@"\n`;
  fs.writeFileSync(FAUX_DISTANT, enveloppe(path.join(BAC, 'faux-distant.cjs')), { mode: 0o755 });
  fs.writeFileSync(FAUX_COPIE, enveloppe(path.join(BAC, 'faux-copie.cjs')), { mode: 0o755 });
  fs.writeFileSync(path.join(SHIMS, 'df'), enveloppe(path.join(BAC, 'faux-df.cjs')), { mode: 0o755 });
  fs.chmodSync(FAUX_DISTANT, 0o755);
  fs.chmodSync(FAUX_COPIE, 0o755);
  fs.chmodSync(path.join(SHIMS, 'df'), 0o755);

  for (const nom of ['ssh', 'scp', 'sftp', 'rsync', 'sshpass']) {
    const chemin = path.join(SHIMS, nom);
    fs.writeFileSync(chemin, `#!/bin/bash\nprintf '%s %s\\n' ${JSON.stringify(nom)} "$*" >> ${JSON.stringify(JOURNAL_INTERDIT)}\necho "banc d'epreuve : ${nom} reel interdit" >&2\nexit 97\n`, { mode: 0o755 });
    fs.chmodSync(chemin, 0o755);
  }

  const secrets = `VIDEOS_SEGMENT=${SEGMENT}\nVIDEOS_UTILISATEUR=${UTILISATEUR}\nVIDEOS_MOT_DE_PASSE=${MOT_DE_PASSE}\n`;
  fs.writeFileSync(CHEMIN_SECRETS, secrets, { mode: 0o600 });
  fs.chmodSync(CHEMIN_SECRETS, 0o600);
  fs.writeFileSync(SECRETS_DEFAUT, secrets, { mode: 0o600 });
  fs.chmodSync(SECRETS_DEFAUT, 0o600);

  fs.writeFileSync(ESPACE_LIBRE, ESPACE_CONFORTABLE);
  fs.writeFileSync(MODE_DISTANT, 'normal');
  fs.writeFileSync(MODE_COPIE, 'normal');
  for (const j of [JOURNAL_DISTANT, JOURNAL_COPIE, JOURNAL_DF, JOURNAL_INTERDIT]) fs.writeFileSync(j, '');
}

/* Remet le banc dans son état de repos entre deux cas. */
function banAuRepos() {
  fs.writeFileSync(ESPACE_LIBRE, ESPACE_CONFORTABLE);
  fs.writeFileSync(MODE_DISTANT, 'normal');
  fs.writeFileSync(MODE_COPIE, 'normal');
  fs.writeFileSync(CHEMIN_SECRETS, `VIDEOS_SEGMENT=${SEGMENT}\nVIDEOS_UTILISATEUR=${UTILISATEUR}\nVIDEOS_MOT_DE_PASSE=${MOT_DE_PASSE}\n`, { mode: 0o600 });
  fs.chmodSync(CHEMIN_SECRETS, 0o600);
  hote?.role('normal');
}

/* ─────────────────────  les vidéos de la source  ───────────────────── */

const LE_4_MARS = new Date(2026, 2, 4, 12, 0, 0);
const LE_17_AOUT = new Date(2025, 7, 17, 12, 0, 0);

const NOM_RETORS = "Répét' n°2 & « fin » #3 100% [essai].mp4";
let SOURCE_SIMPLE = '';
let SOURCE_RETORS = '';
let SOURCE_ACCENT = '';
let SOURCE_TEXTE = '';
let SOURCE_AVI = '';
let SOURCE_FAUX_SUFFIXE = '';
let SOURCE_TIRET = '';
let SOURCE_CREUSE = '';
let SOURCE_RELATIVE = '';

before(async () => {
  PORT_MORT = await portLibre(39100 + Math.floor(Math.random() * 200));
  PORT_WEB = await portLibre(PORT_MORT + 1);
  ecrireBanc();
  hote = await demarrerFauxHote(PORT_WEB);

  SOURCE_SIMPLE = fabriquerVideo(path.join(SOURCES, 'concert-mars.mp4'), 1_234_567, LE_4_MARS);
  SOURCE_RETORS = fabriquerVideo(path.join(SOURCES, NOM_RETORS), 65_432, LE_4_MARS);
  SOURCE_ACCENT = fabriquerVideo(path.join(SOURCES, 'répétition été œuvre.mov'), 12_345, LE_17_AOUT);
  SOURCE_TIRET = fabriquerVideo(path.join(SOURCES, '-video-qui-commence-par-un-tiret.mp4'), 5_000, LE_4_MARS);
  SOURCE_RELATIVE = fabriquerVideo(path.join(SOURCES, 'chemin-relatif.mp4'), 9_999, LE_4_MARS);

  SOURCE_CREUSE = path.join(SOURCES, 'tres-grosse.mp4');
  fs.writeFileSync(SOURCE_CREUSE, enteteVideo('x.mp4'));
  fs.truncateSync(SOURCE_CREUSE, 3 * GIO);   /* CREUX : 3 Gio apparents, ~0 sur le disque */

  SOURCE_TEXTE = path.join(SOURCES, 'notes.txt');
  fs.writeFileSync(SOURCE_TEXTE, 'ceci n\'est pas une vidéo\n');
  SOURCE_AVI = path.join(SOURCES, 'ancien.avi');
  fs.writeFileSync(SOURCE_AVI, Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('AVI ')]));
  SOURCE_FAUX_SUFFIXE = path.join(SOURCES, 'presque.mp4.txt');
  fs.writeFileSync(SOURCE_FAUX_SUFFIXE, 'presque\n');

  fs.mkdirSync(path.join(SOURCES, 'un-dossier'), { recursive: true });
});

after(async () => {
  for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* rien */ } }
  await hote?.fermer().catch(() => {});
  /* On ne laisse traîner aucun fichier de secrets, même jetable. */
  for (const f of [CHEMIN_SECRETS, SECRETS_DEFAUT]) { try { fs.unlinkSync(f); } catch { /* rien */ } }
  try { fs.rmSync(SOURCE_CREUSE, { force: true }); } catch { /* rien */ }
});

/* ═══════════════════════════════════════════════════════════════════
 *   I. CE QUI NE DOIT JAMAIS PASSER
 * ═══════════════════════════════════════════════════════════════════ */

describe('INTERDITS — la page : arguments refusés', () => {
  test('P1 — aucun argument : refus lisible, aucune page sur la sortie standard', async () => {
    const r = await lancer(SCRIPT_PAGE, []);
    assertRefus(r, 'page sans argument');
    assert.ok(!/<html/i.test(r.sortie), 'P1 : une page HTML a quand même été écrite sur la sortie standard');
  });

  test('P2 — dossier inexistant : refus, aucune page produite', async () => {
    const r = await lancer(SCRIPT_PAGE, [path.join(BAC, `dossier-qui-nexiste-pas-${COURSE}`)]);
    assertRefus(r, 'page sur un dossier inexistant');
    assert.ok(!/<html/i.test(r.sortie), 'P2 : une page a quand même été produite');
  });

  test('P3 — un fichier au lieu d\'un dossier : refus', async () => {
    const r = await lancer(SCRIPT_PAGE, [SOURCE_SIMPLE]);
    assertRefus(r, 'page sur un fichier');
  });

  for (const mauvais of ['-rf', '--dossier=/tmp', '-', '--aide']) {
    test(`P4 — argument « ${mauvais} » (commence par un tiret) : refus`, async () => {
      const r = await lancer(SCRIPT_PAGE, [mauvais]);
      assertRefus(r, `page avec l'argument « ${mauvais} »`);
    });
  }
});

describe('INTERDITS — la page ment : ce qui est listé, ce qui est oublié', () => {
  test('P5 — rien qui ne soit pas une vidéo n\'est listé (txt, avi, mpeg, mp4.txt, dossier .mp4, lien mort)', async () => {
    const d = dossierDePage('tri', [
      { nom: 'vraie-un.mp4', taille: 43_210, date: LE_4_MARS },
      { nom: 'vraie-deux.mkv', taille: 86_420, date: LE_17_AOUT },
      { nom: 'notes.txt', type: 'texte' },
      { nom: 'ancien.avi', type: 'texte' },
      { nom: 'film.mpeg', type: 'texte' },
      { nom: 'presque.mp4.txt', type: 'texte' },
      { nom: 'tronque.mp4.part', type: 'texte' },
      { nom: 'bizarre.mp4x', type: 'texte' },
      { nom: 'court.mp', type: 'texte' },
      { nom: 'affiche.jpg', type: 'texte' },
      { nom: 'index.html', type: 'texte' },
      { nom: 'dossier.mp4', type: 'dossier' },
      { nom: 'lien-mort.mp4', type: 'lien-mort' },
    ]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page de tri');
    verifierPageSaine(r.sortie, 'P5');
    verifierPageVraie(r.sortie, d, 'P5');
  });

  test('P6 — les extensions en casse mêlée sont bien des vidéos (.MP4 .MoV .WEBM .MkV .M4V)', async () => {
    const d = dossierDePage('casse', [
      { nom: 'UNE.MP4', taille: 11_111, date: LE_4_MARS },
      { nom: 'deux.MoV', taille: 22_222, date: LE_4_MARS },
      { nom: 'trois.WEBM', taille: 33_333, date: LE_4_MARS },
      { nom: 'quatre.MkV', taille: 44_444, date: LE_17_AOUT },
      { nom: 'cinq.M4V', taille: 55_555, date: LE_17_AOUT },
    ]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page en casse mêlée');
    verifierPageSaine(r.sortie, 'P6');
    verifierPageVraie(r.sortie, d, 'P6');
  });

  test('P7 — noms retors : chaque lien mène exactement au bon fichier', async () => {
    const noms = [
      'un espace.mp4',
      'répétition été œuvre.mov',
      "l'apostrophe.mp4",
      'et & esperluette.mp4',
      'point d\'interrogation ?.mkv',
      'dièse #3.mp4',
      'cent%pourcent.webm',
      'plus+et=egal.m4v',
      'virgule,point;virgule.mp4',
      'crochets [2026] (final).mp4',
      '-commence-par-un-tiret.mp4',
      'deux..points.mp4',
      `nom-tres-long-${'a'.repeat(150)}.mp4`,
      'majuscules ÉÀÇ.mp4',
      'étoile * et tilde ~.mp4',
    ];
    const d = dossierDePage('retors', noms.map((nom, i) => ({ nom, taille: 10_000 + i * 1379, date: LE_4_MARS })));
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page aux noms retors');
    verifierPageSaine(r.sortie, 'P7');
    verifierPageVraie(r.sortie, d, 'P7');
  });

  test('P8 — un nom qui ressemble à du HTML n\'injecte rien', async () => {
    /* Aucun « / » : c'est le seul caractère qu'un nom de fichier ne peut pas
     * porter sous Linux. Les balises sont donc fermées d'une autre façon. */
    const noms = [
      '<img src=x onerror=alert(1)>.mp4',
      '<script >alert(2)<!--.mp4',
      'guillemet" onmouseover="alert(3).mp4',
      'fin<b>gras<b>.mkv',
      '&amp;deja-echappe.mp4',
      '&lt;pas-une-balise&gt;.mp4',
    ];
    const d = dossierDePage('injection', noms.map((nom, i) => ({ nom, taille: 20_000 + i * 777, date: LE_17_AOUT })));
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page au nom piégé');
    verifierPageSaine(r.sortie, 'P8');
    for (const morceau of ['<img src=x', '<script >alert', '<b>gras', '" onmouseover=']) {
      assert.ok(!r.sortie.includes(morceau), `P8 : « ${morceau} » est passé TEL QUEL dans la page — un nom de fichier injecte du HTML`);
    }
    verifierPageVraie(r.sortie, d, 'P8');
  });

  test('P9 — un nom contenant un saut de ligne ne casse ni la liste ni les liens', async () => {
    const d = dossierDePage('saut-de-ligne', [
      { nom: 'avant.mp4', taille: 32_100, date: LE_4_MARS },
      { nom: 'deux\nlignes.mp4', taille: 43_100, date: LE_4_MARS },
      { nom: 'apres.mp4', taille: 54_100, date: LE_4_MARS },
    ]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page avec un nom à saut de ligne');
    verifierPageSaine(r.sortie, 'P9');
    verifierPageVraie(r.sortie, d, 'P9', { sansTailleNiDate: true });
  });
});

describe('INTERDITS — la page doit être muette pour les moteurs, sans style ni script en ligne', () => {
  test('P10 — noindex présent, aucun <style>, aucun style="…", aucun script en ligne', async () => {
    const d = dossierDePage('politique', [
      { nom: 'a.mp4', taille: 15_000, date: LE_4_MARS },
      { nom: 'b.mov', taille: 25_000, date: LE_4_MARS },
      { nom: 'c.webm', taille: 35_000, date: LE_17_AOUT },
    ]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page de politique');
    verifierPageSaine(r.sortie, 'P10');
  });

  test('P11 — la page ne contient ni le mot de passe ni le nom d\'utilisateur de Matthieu', async () => {
    const d = dossierDePage('fuite', [{ nom: 'a.mp4', taille: 15_000, date: LE_4_MARS }]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page de fuite');
    assert.ok(!r.sortie.includes(MOT_DE_PASSE), 'P11 : le MOT DE PASSE est écrit dans la page');
    assert.ok(!r.sortie.includes(UTILISATEUR), 'P11 : le nom d\'utilisateur est écrit dans la page');
  });
});

describe('INTERDITS — dépôt : refuser AVANT de toucher au réseau', () => {
  test('D1 — aucun argument : refus, réseau intact', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_DEPOSER, []);
    assertRefus(r, 'dépôt sans argument');
    verifierReseauIntact(avant, 'dépôt sans argument');
  });

  for (const mauvais of ['-x', '--delete', '-rf', '--mot-de-passe=abc', '-', '--exclude=*']) {
    test(`D2 — argument « ${mauvais} » : refus, réseau intact`, async () => {
      banAuRepos();
      const avant = etatReseau();
      const r = await lancer(SCRIPT_DEPOSER, [mauvais]);
      assertRefus(r, `dépôt avec « ${mauvais} »`);
      verifierReseauIntact(avant, `dépôt avec « ${mauvais} »`);
    });
  }

  test('D3 — un fichier qui EXISTE mais dont le nom commence par un tiret : refus', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_DEPOSER, [path.basename(SOURCE_TIRET)], { cwd: SOURCES });
    assertRefus(r, 'dépôt d\'un nom commençant par un tiret');
    verifierReseauIntact(avant, 'dépôt d\'un nom commençant par un tiret');
  });

  test('D4 — fichier inexistant : refus, réseau intact', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_DEPOSER, [path.join(SOURCES, `absent-${COURSE}.mp4`)]);
    assertRefus(r, 'dépôt d\'un fichier absent');
    verifierReseauIntact(avant, 'dépôt d\'un fichier absent');
  });

  for (const [nom, obtenir] of [
    ['un fichier texte', () => SOURCE_TEXTE],
    ['un .avi (hors des formats admis)', () => SOURCE_AVI],
    ['un .mp4.txt', () => SOURCE_FAUX_SUFFIXE],
    ['un dossier', () => path.join(SOURCES, 'un-dossier')],
  ]) {
    test(`D5 — ${nom} : refus, réseau intact`, async () => {
      banAuRepos();
      const avant = etatReseau();
      const r = await lancer(SCRIPT_DEPOSER, [obtenir()]);
      assertRefus(r, `dépôt de ${nom}`);
      verifierReseauIntact(avant, `dépôt de ${nom}`);
    });
  }

  test('D6 — une vidéo valide ET un intrus : TOUT est refusé, rien n\'est copié', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE, SOURCE_TEXTE]);
    assertRefus(r, 'dépôt mêlant une vidéo et un intrus');
    verifierReseauIntact(avant, 'dépôt mêlant une vidéo et un intrus');
  });
});

describe('INTERDITS — dépôt : le fichier de secrets', () => {
  test('S1 — fichier de secrets absent : refus, réseau intact', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { env: { VIDEOS_SECRETS: path.join(BAC, `secrets-absents-${COURSE}.env`) } });
    assertRefus(r, 'dépôt sans fichier de secrets');
    verifierReseauIntact(avant, 'dépôt sans fichier de secrets');
  });

  for (const droits of [0o644, 0o640, 0o664, 0o666, 0o606]) {
    test(`S2 — fichier de secrets en ${droits.toString(8).padStart(4, '0')} : refus, réseau intact`, async () => {
      banAuRepos();
      fs.chmodSync(CHEMIN_SECRETS, droits);
      const avant = etatReseau();
      const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE]);
      fs.chmodSync(CHEMIN_SECRETS, 0o600);
      assertRefus(r, `dépôt avec des secrets en ${droits.toString(8)}`);
      verifierReseauIntact(avant, `dépôt avec des secrets en ${droits.toString(8)}`);
    });
  }

  for (const [nom, contenu] of [
    ['sans VIDEOS_MOT_DE_PASSE', `VIDEOS_SEGMENT=${SEGMENT}\nVIDEOS_UTILISATEUR=${UTILISATEUR}\n`],
    ['avec un mot de passe vide', `VIDEOS_SEGMENT=${SEGMENT}\nVIDEOS_UTILISATEUR=${UTILISATEUR}\nVIDEOS_MOT_DE_PASSE=\n`],
    ['sans VIDEOS_SEGMENT', `VIDEOS_UTILISATEUR=${UTILISATEUR}\nVIDEOS_MOT_DE_PASSE=${MOT_DE_PASSE}\n`],
    ['vide', ''],
  ]) {
    test(`S3 — fichier de secrets ${nom} : refus, réseau intact`, async () => {
      banAuRepos();
      fs.writeFileSync(CHEMIN_SECRETS, contenu, { mode: 0o600 });
      fs.chmodSync(CHEMIN_SECRETS, 0o600);
      const avant = etatReseau();
      const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE]);
      banAuRepos();
      assertRefus(r, `dépôt avec des secrets ${nom}`);
      verifierReseauIntact(avant, `dépôt avec des secrets ${nom}`);
    });
  }
});

describe('INTERDITS — dépôt : l\'espace libre du serveur', () => {
  test('E1 — 5 Gio libres sur le serveur : refus, aucune copie', { timeout: 60000 }, async () => {
    banAuRepos();
    fs.writeFileSync(ESPACE_LIBRE, String(5 * GIO));
    const dfAvant = compterLignes(JOURNAL_DF);
    const copieAvant = compterLignes(JOURNAL_COPIE);
    const serveurAvant = etatFauxServeur();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { delaiMs: 45000 });
    banAuRepos();
    assertRefus(r, 'dépôt avec 5 Gio libres');
    assert.ok(compterLignes(JOURNAL_DF) > dfAvant, 'E1 : le script n\'a JAMAIS demandé l\'espace libre (aucun appel à df) — il ne peut donc pas refuser à 5 Gio');
    assert.equal(compterLignes(JOURNAL_COPIE), copieAvant, 'E1 : une copie a été lancée alors que le serveur n\'a que 5 Gio libres');
    assert.deepEqual(etatFauxServeur(), serveurAvant, 'E1 : le faux serveur a changé');
  });

  test('E2 — 21 Gio libres et un fichier de 3 Gio : refus, car après copie il resterait moins de 20 Go', { timeout: 90000 }, async () => {
    banAuRepos();
    fs.writeFileSync(ESPACE_LIBRE, String(21 * GIO));
    const copieAvant = compterLignes(JOURNAL_COPIE);
    const serveurAvant = etatFauxServeur();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_CREUSE], { delaiMs: 60000 });
    banAuRepos();
    assertRefus(r, 'dépôt de 3 Gio avec 21 Gio libres');
    assert.equal(compterLignes(JOURNAL_COPIE), copieAvant, 'E2 : la copie a été lancée alors qu\'après elle il resterait 18 Gio');
    assert.deepEqual(etatFauxServeur(), serveurAvant, 'E2 : le faux serveur a changé');
  });
});

describe('INTERDITS — dépôt : jamais « déposé, vérifié » à tort', () => {
  const casHote = [
    ['la page répond 200 SANS identifiants (elle est publique)', 'ouvert'],
    ['l\'hôte répond 401 MÊME AVEC les identifiants', 'refuse'],
    ['l\'hôte répond 500 avec les identifiants', 'panne'],
    ['l\'hôte répond 404 avec les identifiants (le fichier n\'est pas là)', 'absent'],
  ];
  for (const [nom, role] of casHote) {
    test(`H — ${nom} : le dépôt échoue, il n'est pas déclaré vérifié`, { timeout: 90000 }, async () => {
      banAuRepos();
      hote.role(role);
      const t0 = Date.now();
      const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { delaiMs: 60000 });
      banAuRepos();
      exigerPresent(r);
      assert.equal(r.bloque, false, `« ${nom} » : le script ne rend jamais la main`);
      assert.notEqual(r.code, 0, `« ${nom} » : le script a déclaré le dépôt RÉUSSI (code 0) — la faute la plus grave. Sortie : ${apercu(r)}`);
      assert.ok(hote.depuis(t0).length > 0, `« ${nom} » : le script n'a JAMAIS interrogé l'hôte web — soit il ne contrôle rien (et ne peut donc que mentir), soit il s'est arrêté plus tôt sans jamais arriver au contrôle. Sortie : ${apercu(r)}`);
      assert.notEqual(`${r.sortie}${r.err}`.trim(), '', `« ${nom} » : échec MUET, aucun message`);
    });
  }

  test('H5 — l\'hôte web ne répond pas du tout : échec net, pas de blocage', { timeout: 120000 }, async () => {
    banAuRepos();
    await hote.arreter();
    let r;
    try {
      r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { delaiMs: 60000 });
    } finally {
      await hote.relancer();
      banAuRepos();
    }
    exigerPresent(r);
    assert.equal(r.bloque, false, 'H5 : le script reste bloqué sur un hôte muet (tué au bout de 60 s)');
    assert.notEqual(r.code, 0, `H5 : le script a déclaré le dépôt réussi alors que l'hôte web ne répond pas. Sortie : ${apercu(r)}`);
  });

  test('H6 — la copie échoue : échec net, et la vidéo n\'apparaît ni sur le serveur ni sur la page', { timeout: 90000 }, async () => {
    banAuRepos();
    fs.writeFileSync(MODE_COPIE, 'panne');
    const avant = videosDistantes();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { delaiMs: 60000 });
    banAuRepos();
    exigerPresent(r);
    assert.equal(r.bloque, false, 'H6 : le script ne rend jamais la main');
    assert.notEqual(r.code, 0, `H6 : la copie a échoué et le script a quand même déclaré le dépôt réussi. Sortie : ${apercu(r)}`);
    assert.deepEqual(videosDistantes(), avant, 'H6 : une vidéo est apparue sur le serveur alors que la copie a échoué');
    const page = pageDistante();
    if (page) {
      /* La page peut légitimement lister ce qui est DÉJÀ sur le serveur ;
       * ce qu'elle ne doit jamais faire, c'est annoncer un fichier absent. */
      const lies = [...new Set(hrefsDe(page.html).map(decoderLien).filter((l) => l.decode && EXT_VIDEO.test(l.decode)).map((l) => l.decode))];
      const presentes = videosDistantes();
      const fantomes = lies.filter((n) => !presentes.includes(n));
      assert.deepEqual(fantomes, [],
        `H6 : la page distante annonce ${JSON.stringify(fantomes)}, que la copie n'a jamais déposée — la page MENT`);
    }
  });

  test('H7 — la commande distante échoue : échec net', { timeout: 90000 }, async () => {
    banAuRepos();
    fs.writeFileSync(MODE_DISTANT, 'panne');
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE], { delaiMs: 60000 });
    banAuRepos();
    exigerPresent(r);
    assert.equal(r.bloque, false, 'H7 : le script ne rend jamais la main');
    assert.notEqual(r.code, 0, `H7 : le serveur répondait en panne et le script a déclaré le dépôt réussi. Sortie : ${apercu(r)}`);
  });
});

describe('INTERDITS — retrait', () => {
  test('R1 — aucun argument : refus, réseau intact', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_RETIRER, []);
    assertRefus(r, 'retrait sans argument');
    verifierReseauIntact(avant, 'retrait sans argument');
  });

  for (const mauvais of ['sous/dossier.mp4', '/etc/passwd', '../secret.mp4', '..', '.', 'a/../b.mp4', './c.mp4', 'd.mp4/', '/']) {
    test(`R2 — nom « ${mauvais} » (contient / ou ..) : refus, rien n'est touché`, async () => {
      banAuRepos();
      const avant = etatReseau();
      const r = await lancer(SCRIPT_RETIRER, [mauvais]);
      assertRefus(r, `retrait de « ${mauvais} »`);
      verifierReseauIntact(avant, `retrait de « ${mauvais} »`);
    });
  }

  for (const mauvais of ['-rf', '--all', '-']) {
    test(`R3 — nom « ${mauvais} » (commence par un tiret) : refus, rien n'est touché`, async () => {
      banAuRepos();
      const avant = etatReseau();
      const r = await lancer(SCRIPT_RETIRER, [mauvais]);
      assertRefus(r, `retrait de « ${mauvais} »`);
      verifierReseauIntact(avant, `retrait de « ${mauvais} »`);
    });
  }

  test('R4 — nom vide : refus, rien n\'est touché', async () => {
    banAuRepos();
    const avant = etatReseau();
    const r = await lancer(SCRIPT_RETIRER, ['']);
    assertRefus(r, 'retrait d\'un nom vide');
    verifierReseauIntact(avant, 'retrait d\'un nom vide');
  });
});

/* ═══════════════════════════════════════════════════════════════════
 *   II. CE QUI DOIT CONTINUER DE MARCHER
 *   (avec, au milieu, les trois interdits du retrait qui ont besoin
 *    d'un serveur déjà garni : R5, R6, R7)
 * ═══════════════════════════════════════════════════════════════════ */

describe('TÉMOINS — la page', () => {
  test('T0 — dossier VIDE : une page complète qui le dit, et pas un lien', async () => {
    const d = dossierDePage('vide', []);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page sur un dossier vide');
    verifierPageSaine(r.sortie, 'T0');
    const liens = hrefsDe(r.sortie).map(decoderLien).filter((l) => l.decode && EXT_VIDEO.test(l.decode));
    assert.deepEqual(liens.map((l) => l.decode), [], 'T0 : la page d\'un dossier vide propose des vidéos');
    assert.ok(texteDe(r.sortie).length > 5, 'T0 : la page d\'un dossier vide ne dit rien du tout');
  });

  test('T1 — UN fichier : nom, taille juste, date, et un lien qui pointe dessus', async () => {
    const d = dossierDePage('un-seul', [{ nom: 'unique.mp4', taille: 1_048_576, date: LE_4_MARS }]);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page à un fichier');
    verifierPageSaine(r.sortie, 'T1');
    verifierPageVraie(r.sortie, d, 'T1');
  });

  test('T2 — VINGT-CINQ fichiers : tous listés, tous les liens exacts', async () => {
    const fichiers = [];
    for (let i = 1; i <= 25; i++) fichiers.push({ nom: `serie-${String(i).padStart(2, '0')}.mp4`, taille: 30_000 + i * 1013, date: LE_4_MARS });
    const d = dossierDePage('vingt-cinq', fichiers);
    const r = await lancer(SCRIPT_PAGE, [d]);
    assertSucces(r, 'page à 25 fichiers');
    verifierPageSaine(r.sortie, 'T2');
    verifierPageVraie(r.sortie, d, 'T2');
  });

  test('T3 — dossier au chemin RELATIF et au nom accentué : la page est juste', async () => {
    const d = dossierDePage('dossier accentué été', [
      { nom: 'a.mp4', taille: 40_960, date: LE_17_AOUT },
      { nom: 'b.mkv', taille: 81_920, date: LE_17_AOUT },
    ]);
    const relatif = path.relative(PAGES, d);
    const r = await lancer(SCRIPT_PAGE, [relatif], { cwd: PAGES });
    assertSucces(r, 'page sur un chemin relatif');
    verifierPageSaine(r.sortie, 'T3');
    verifierPageVraie(r.sortie, d, 'T3');
  });
});

describe('TÉMOINS — le dépôt et le retrait', () => {
  test('T4 — dépôt nominal de trois vidéos : il aboutit, les contrôles ont VRAIMENT eu lieu, chaque lien sert le bon fichier', { timeout: 150000 }, async () => {
    banAuRepos();
    const t0 = Date.now();
    const r = await lancer(SCRIPT_DEPOSER, [SOURCE_SIMPLE, SOURCE_RETORS, SOURCE_ACCENT], { delaiMs: 90000 });
    assertSucces(r, 'dépôt nominal');

    const attendues = [SOURCE_SIMPLE, SOURCE_RETORS, SOURCE_ACCENT].map((p) => path.basename(p)).sort();
    const surLeServeur = videosDistantes();
    for (const n of attendues) assert.ok(surLeServeur.includes(n), `T4 : « ${n} » n'est jamais arrivée sur le serveur (présentes : ${JSON.stringify(surLeServeur)})`);

    const page = pageDistante();
    assert.ok(page, 'T4 : aucune page n\'a été envoyée sur le serveur');
    verifierPageSaine(page.html, 'T4 (page distante)');
    const liens = hrefsDe(page.html).map(decoderLien).filter((l) => l.decode && EXT_VIDEO.test(l.decode));
    for (const l of liens) assert.ok(l.valide, `T4 : lien mal formé (${l.raison}) : ${l.brut}`);
    assert.deepEqual([...new Set(liens.map((l) => l.decode))].sort(), surLeServeur,
      'T4 : la page distante ne liste pas exactement les vidéos réellement présentes sur le serveur');

    /* Les contrôles HTTP ont-ils réellement eu lieu ? */
    const vues = hote.depuis(t0);
    assert.ok(vues.length > 0, 'T4 : le script n\'a JAMAIS interrogé l\'hôte web — il déclare « vérifié » sans rien vérifier');
    for (const n of attendues) {
      assert.ok(vues.some((v) => v.nom === n && !v.aAuth && v.statut === 401),
        `T4 : le script n'a jamais vérifié SANS identifiants que « ${n} » est protégée (une page publique passerait inaperçue).\n  vues : ${JSON.stringify(vues.map((v) => [v.nom, v.aAuth, v.statut]))}`);
      assert.ok(vues.some((v) => v.nom === n && v.aAuth && (v.statut === 200 || v.statut === 206)),
        `T4 : le script n'a jamais vérifié AVEC identifiants que « ${n} » se télécharge`);
    }

    /* Et chaque lien de la page mène-t-il vraiment au fichier ? */
    for (const l of liens) {
      const url = urlDuLien(l.brut);
      const sans = await demander(url, { auth: false });
      assert.equal(sans.statut, 401, `T4 : le lien « ${l.decode} » répond ${sans.statut} SANS identifiants — il devrait être protégé`);
      const avec = await demander(url);
      assert.equal(avec.statut, 200, `T4 : le lien « ${l.decode} » ne mène à rien (${avec.statut})`);
      const local = [SOURCE_SIMPLE, SOURCE_RETORS, SOURCE_ACCENT].find((p) => path.basename(p) === l.decode);
      assert.ok(local, `T4 : la page propose « ${l.decode} », qui n'a pas été déposée`);
      assert.ok(avec.corps.equals(fs.readFileSync(local)), `T4 : le fichier servi pour « ${l.decode} » n'est pas la vidéo déposée`);
    }
  });

  test('T5 — dépôt par un CHEMIN RELATIF : il aboutit', { timeout: 120000 }, async () => {
    banAuRepos();
    const r = await lancer(SCRIPT_DEPOSER, [path.basename(SOURCE_RELATIVE)], { cwd: SOURCES, delaiMs: 90000 });
    assertSucces(r, 'dépôt par chemin relatif');
    assert.ok(videosDistantes().includes(path.basename(SOURCE_RELATIVE)), 'T5 : la vidéo donnée en chemin relatif n\'est pas arrivée');
  });

  test('T6 — sans VIDEOS_SECRETS : le chemin par défaut (~/.config/chalou/videos-matthieu.env, 0600) est lu et le dépôt aboutit', { timeout: 120000 }, async () => {
    banAuRepos();
    const source = fabriquerVideo(path.join(SOURCES, 'chemin-par-defaut.m4v'), 7_777, LE_17_AOUT);
    const r = await lancer(SCRIPT_DEPOSER, [source], { sansEnv: ['VIDEOS_SECRETS'], delaiMs: 90000 });
    assertSucces(r, 'dépôt avec le chemin de secrets par défaut');
    assert.ok(videosDistantes().includes('chemin-par-defaut.m4v'), 'T6 : la vidéo n\'est pas arrivée');
  });

  test('T7 — un second dépôt n\'efface pas le premier : la page liste tout', { timeout: 120000 }, async () => {
    banAuRepos();
    const avant = videosDistantes();
    assert.ok(avant.length > 0, 'T7 : rien n\'avait été déposé, ce cas ne prouverait rien');
    const source = fabriquerVideo(path.join(SOURCES, 'ajout-tardif.webm'), 6_543, LE_4_MARS);
    const r = await lancer(SCRIPT_DEPOSER, [source], { delaiMs: 90000 });
    assertSucces(r, 'second dépôt');
    const apres = videosDistantes();
    for (const n of avant) assert.ok(apres.includes(n), `T7 : « ${n} » a disparu du serveur pendant le dépôt suivant`);
    assert.ok(apres.includes('ajout-tardif.webm'), 'T7 : la nouvelle vidéo n\'est pas arrivée');
    const page = pageDistante();
    assert.ok(page, 'T7 : aucune page distante');
    const lies = [...new Set(hrefsDe(page.html).map(decoderLien).filter((l) => l.decode && EXT_VIDEO.test(l.decode)).map((l) => l.decode))].sort();
    assert.deepEqual(lies, apres, 'T7 : la page distante ne liste pas exactement ce qui est sur le serveur');
  });

  test('R5 — INTERDIT : retirer un nom ABSENT du serveur ne doit pas être déclaré réussi', { timeout: 90000 }, async () => {
    banAuRepos();
    const avant = videosDistantes();
    const r = await lancer(SCRIPT_RETIRER, [`jamais-deposee-${COURSE}.mp4`], { delaiMs: 60000 });
    assertRefus(r, 'retrait d\'un nom absent');
    assert.deepEqual(videosDistantes(), avant, 'R5 : le serveur a changé alors que le nom n\'existait pas');
  });

  test('R6 — INTERDIT : retirer « * » ne vide pas le serveur', { timeout: 90000 }, async () => {
    banAuRepos();
    const avant = videosDistantes();
    assert.ok(avant.length > 1, 'R6 : il n\'y a pas assez de vidéos déposées, ce cas ne prouverait rien');
    const r = await lancer(SCRIPT_RETIRER, ['*'], { delaiMs: 60000 });
    exigerPresent(r);
    const apres = videosDistantes();
    assert.deepEqual(apres, avant, `R6 : « * » a effacé des vidéos (${JSON.stringify(avant)} → ${JSON.stringify(apres)})`);
    assert.notEqual(r.code, 0, `R6 : le script a déclaré avoir retiré « * » (code 0) alors qu'aucun fichier ne porte ce nom. Sortie : ${apercu(r)}`);
  });

  test('R7 — INTERDIT : l\'ancien fichier répond ENCORE 200 (hôte fantôme) — le retrait ne doit pas être déclaré vérifié', { timeout: 120000 }, async () => {
    banAuRepos();
    const cible = fabriquerVideo(path.join(SOURCES, 'a-retirer-fantome.mp4'), 4_242, LE_4_MARS);
    const depot = await lancer(SCRIPT_DEPOSER, [cible], { delaiMs: 90000 });
    assertSucces(depot, 'R7 (dépôt préalable)');
    hote.role('fantome');
    const r = await lancer(SCRIPT_RETIRER, ['a-retirer-fantome.mp4'], { delaiMs: 60000 });
    banAuRepos();
    exigerPresent(r);
    assert.equal(r.bloque, false, 'R7 : le script ne rend jamais la main');
    assert.notEqual(r.code, 0, `R7 : l'ancien fichier répondait encore 200 et le script a déclaré le retrait vérifié. Sortie : ${apercu(r)}`);
  });

  test('T8 — retrait nominal : la vidéo part, la page ne la liste plus, les autres restent, le 404 est vraiment contrôlé', { timeout: 150000 }, async () => {
    banAuRepos();
    const cible = fabriquerVideo(path.join(SOURCES, 'a-retirer.mp4'), 5_432, LE_4_MARS);
    const depot = await lancer(SCRIPT_DEPOSER, [cible], { delaiMs: 90000 });
    assertSucces(depot, 'T8 (dépôt préalable)');
    assert.ok(videosDistantes().includes('a-retirer.mp4'), 'T8 : la vidéo à retirer n\'a pas été déposée');
    const avant = videosDistantes();

    const t0 = Date.now();
    const r = await lancer(SCRIPT_RETIRER, ['a-retirer.mp4'], { delaiMs: 60000 });
    assertSucces(r, 'retrait nominal');

    const apres = videosDistantes();
    assert.ok(!apres.includes('a-retirer.mp4'), 'T8 : la vidéo est toujours sur le serveur après un retrait déclaré réussi');
    for (const n of avant.filter((x) => x !== 'a-retirer.mp4')) {
      assert.ok(apres.includes(n), `T8 : « ${n} » a été emportée par le retrait d'une autre vidéo`);
    }
    const page = pageDistante();
    assert.ok(page, 'T8 : aucune page distante');
    const lies = [...new Set(hrefsDe(page.html).map(decoderLien).filter((l) => l.decode && EXT_VIDEO.test(l.decode)).map((l) => l.decode))].sort();
    assert.ok(!lies.includes('a-retirer.mp4'), 'T8 : la page distante annonce encore la vidéo retirée — elle MENT');
    assert.deepEqual(lies, apres, 'T8 : la page distante ne liste pas exactement ce qui reste sur le serveur');
    const vues = hote.depuis(t0);
    assert.ok(vues.some((v) => v.nom === 'a-retirer.mp4' && v.statut === 404),
      `T8 : le script n'a jamais constaté que l'ancien fichier répond 404.\n  vues : ${JSON.stringify(vues.map((v) => [v.nom, v.aAuth, v.statut]))}`);
  });

  test('T9 — après tous ces refus, un dépôt nominal marche encore (l\'outil n\'est pas devenu muet)', { timeout: 120000 }, async () => {
    banAuRepos();
    const source = fabriquerVideo(path.join(SOURCES, 'dernier-temoin.mp4'), 3_210, LE_17_AOUT);
    const r = await lancer(SCRIPT_DEPOSER, [source], { delaiMs: 90000 });
    assertSucces(r, 'dépôt témoin final');
    assert.ok(videosDistantes().includes('dernier-temoin.mp4'), 'T9 : la vidéo n\'est pas arrivée');
  });

  test('L1 — ni le mot de passe ni les identifiants ne traînent : ni dans la page, ni dans les commandes distantes, et aucun ssh réel n\'a été tenté', () => {
    const distant = lireJournal(JOURNAL_DISTANT);
    assert.notEqual(distant.trim(), '', 'L1 : aucune commande distante n\'a jamais été lancée — ce cas ne prouverait rien');
    assert.ok(!distant.includes(MOT_DE_PASSE), 'L1 : le MOT DE PASSE est passé en clair dans une commande distante (visible dans la liste des processus du serveur)');
    const page = pageDistante();
    assert.ok(page, 'L1 : aucune page distante — ce cas ne prouverait rien');
    assert.ok(!page.html.includes(MOT_DE_PASSE), 'L1 : le MOT DE PASSE est écrit dans la page servie à Matthieu');
    assert.equal(compterLignes(JOURNAL_INTERDIT), 0, `L1 : une vraie commande distante (ssh/scp/rsync) a été tentée, ou une sortie hors du banc :\n${lireJournal(JOURNAL_INTERDIT)}`);
  });
});
