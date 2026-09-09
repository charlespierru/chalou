/* ÉPREUVE INDÉPENDANTE — webhook GitHub qui déploie FadeBeat sur chalou.link.
 *
 * Écrite à partir du BUT et des INTERDITS seulement. La logique de la route
 * (server/src/routes/github.js) n'a PAS été ouverte. Seuls ont été relevés :
 * la forme du banc existant (epreuve-contact.test.js), les noms des réglages
 * (config.js, .env.example) et le fait que le courrier part OBLIGATOIREMENT
 * en STARTTLS authentifié sur le port 587 (garde-fou de config.js).
 *
 * LE BANC, ET SES DEUX ARTIFICES (dits franchement) :
 *  1. Le port 587 est imposé par config.js et ne peut pas être lié par un
 *     utilisateur ordinaire. Le service est donc lancé avec un module
 *     préchargé (--import, URL data:) qui ne fait qu'UNE chose : quand le
 *     service ouvre une connexion vers le port 587, elle est dirigée vers le
 *     port du faux courrier du banc. Rien d'autre n'est touché.
 *  2. Le faux courrier du banc parle STARTTLS avec un certificat auto-signé
 *     fabriqué à chaque exécution ; ce certificat est donné au service par
 *     NODE_EXTRA_CA_CERTS. Le faux courrier existant (faux-serveur-courrier.js)
 *     ne parle ni TLS ni AUTH : il ne peut plus capturer un seul message
 *     depuis la règle du 587 — c'est signalé dans le rapport.
 *
 * Lancement : node --test epreuve/epreuve-webhook-fadebeat.test.js
 * (ou directement : node epreuve/epreuve-webhook-fadebeat.test.js)
 * Réglages facultatifs : EPREUVE_RACINE (racine du projet), EPREUVE_BAC
 * (dossier de banc ; défaut epreuve/bac).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

/* ─────────────────────────  le banc  ───────────────────────── */

const RACINE = process.env.EPREUVE_RACINE
  ? path.resolve(process.env.EPREUVE_RACINE)
  : fileURLToPath(new URL('../', import.meta.url));
const COURSE = Math.random().toString(36).slice(2, 7).toUpperCase();
const BAC = path.join(process.env.EPREUVE_BAC ?? path.join(RACINE, 'epreuve/bac'), `webhook-${COURSE}`);
const DOSSIER_FADEBEAT = path.join(BAC, 'fadebeat');
const CHEMIN_CLE_PARTAGEE = path.join(BAC, 'cle-partagee-webhook');

const DEPOT = 'charlespierru/FadeBeat';
const ROUTE = '/api/github/fadebeat';
const LIGNE_CDN = '<script src="https://cdn.tailwindcss.com"></script>';
const LIGNE_LOCALE = '<script src="tailwind.js"></script>';

/* La clé partagée du webhook (le « secret » GitHub) : PREMIÈRE ligne du
 * fichier. La seconde ligne existe exprès : un service qui lit « tout le
 * fichier » signera faux — et le mandat dit bien première ligne.
 * Valeur aléatoire, jetable, propre à cette exécution. */
const CLE_PARTAGEE = `banc-${COURSE}-${randomBytes(20).toString('hex')}`;
const SECONDE_LIGNE = `seconde-ligne-a-ignorer-${randomBytes(8).toString('hex')}`;

let compteur = 0;
const repere = (cas) => `EPR-${cas}-${COURSE}-${++compteur}`;
const ipUnique = () =>
  `127.${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 250)}`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function jusqua(condition, msMax = 6000, pas = 150) {
  const fin = Date.now() + msMax;
  for (;;) {
    const v = await condition();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dormir(pas);
  }
}
const sha40 = () => randomBytes(20).toString('hex');
const empreinte = (b) => createHash('sha256').update(b).digest('hex');

/* ─────────────────────  requêtes HTTP  ───────────────────── */

const TOUTES_LES_REPONSES = [];   /* pour la chasse à la clé, à la fin */

function envoyer(methode, chemin, corps, opts = {}) {
  const donnees = corps === undefined ? null : (Buffer.isBuffer(corps) ? corps : Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps)));
  const debut = Date.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: opts.port ?? PORT_SERVICE, path: chemin, method: methode, family: 4,
        localAddress: opts.ip ?? ipUnique(),
        headers: {
          ...(donnees === null ? {} : { 'content-type': opts.typeContenu ?? 'application/json', 'content-length': donnees.length }),
          ...(opts.entetes ?? {}),
        },
      },
      (rep) => {
        let texte = '';
        rep.setEncoding('utf8');
        rep.on('data', (m) => { texte += m; });
        rep.on('end', () => {
          const r = { statut: rep.statusCode, entetes: rep.headers, texte, ms: Date.now() - debut, silence: false };
          TOUTES_LES_REPONSES.push(r);
          resolve(r);
        });
      },
    );
    req.setTimeout(opts.timeoutMs ?? 25000, () => req.destroy(new Error('AUCUNE RÉPONSE (délai dépassé)')));
    req.on('error', (e) => resolve({ statut: 0, entetes: {}, texte: '', erreur: e.message, ms: Date.now() - debut, silence: true }));
    if (donnees !== null) req.write(donnees);
    req.end();
  });
}

const signer = (corps, cle = CLE_PARTAGEE) =>
  'sha256=' + createHmac('sha256', cle).update(Buffer.isBuffer(corps) ? corps : Buffer.from(corps)).digest('hex');

/* Une livraison « comme GitHub » : mêmes en-têtes, signature juste par défaut. */
function livrer(corps, opts = {}) {
  const brut = Buffer.isBuffer(corps) ? corps : Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps));
  const livraison = opts.livraison ?? randomUUID();
  const entetes = {
    'x-github-event': opts.evenement ?? 'push',
    'x-github-delivery': livraison,
    'x-github-hook-id': '424242',
    'x-github-hook-installation-target-type': 'repository',
    'user-agent': 'GitHub-Hookshot/7e4c2a1',
    ...(opts.sansSignature ? {} : { 'x-hub-signature-256': opts.signature ?? signer(brut, opts.cle ?? CLE_PARTAGEE) }),
    ...(opts.entetes ?? {}),
  };
  if (opts.sansEvenement) delete entetes['x-github-event'];
  return envoyer('POST', ROUTE, brut, { entetes, ip: opts.ip, port: opts.port, typeContenu: opts.typeContenu, timeoutMs: opts.timeoutMs })
    .then((r) => ({ ...r, livraison }));
}

const depot = (fullName = DEPOT) => ({
  id: 4242, name: fullName.split('/')[1], full_name: fullName, private: false, default_branch: 'master',
  html_url: `https://github.com/${fullName}`, owner: { login: fullName.split('/')[0] },
});
const push = (after, extra = {}) => ({
  ref: 'refs/heads/master', before: sha40(), after, created: false, deleted: false, forced: false,
  repository: depot(), pusher: { name: 'charlespierru', email: 'x@example.com' }, sender: { login: 'charlespierru' },
  head_commit: { id: after, message: 'mise à jour', timestamp: new Date().toISOString() }, commits: [],
  ...extra,
});
const ping = () => ({ zen: 'Keep it logically awesome.', hook_id: 424242, hook: { type: 'Repository', id: 424242, events: ['push'] }, repository: depot() });

/* ─────────────────────  contenu FadeBeat de banc  ───────────────────── */

function fabriquerHtml({ marque, taille = 40_000, cdn = 1, ligneCdn = LIGNE_CDN, doctype = true, ascii = false }) {
  let tete = (doctype ? '<!DOCTYPE html>\n' : '') +
    `<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <title>FadeBeat ${marque}</title>\n` +
    (cdn >= 1 ? `  ${ligneCdn}\n` : '') +
    `  <link rel="icon" href="data:,">\n</head>\n<body>\n<h1>FadeBeat ${ascii ? '-' : '—'} ${marque}</h1>\n`;
  if (cdn >= 2) tete += `  ${ligneCdn}\n`;
  const phrase = ascii
    ? 'lorem ipsum dolor sit amet, texte en ASCII pur pour compter des octets.'
    : 'lorem ipsum dolor sit amet, œuvre à l\'été, « guillemets », &amp; entités.';
  let corps = '';
  let i = 0;
  while (tete.length + corps.length < taille) {
    corps += `<p id="p${i++}">Paragraphe ${i} ${marque} ${phrase}</p>\n`;
  }
  return tete + corps + '</body>\n</html>\n';
}
const transformeAttendu = (html) => html.replace(LIGNE_CDN, LIGNE_LOCALE);
/* Le fichier servi, débarrassé du commentaire qui porte le sha (et ce que le
 * service y ajoute, horodatage compris). */
const sansCommentaire = (texte, sha) => texte.replace(/[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n?/g, (m) => (m.includes(sha) ? '' : m));

/* Ce que le dossier servi contient, à l'instant t. */
function etatDossier(dossier = DOSSIER_FADEBEAT) {
  const fichiers = fs.existsSync(dossier) ? fs.readdirSync(dossier).sort() : [];
  const lire = (f) => { try { return fs.readFileSync(path.join(dossier, f)); } catch { return null; } };
  const index = lire('index.html');
  const tailwind = lire('tailwind.js');
  return {
    fichiers,
    index: index === null ? null : empreinte(index),
    indexTaille: index === null ? -1 : index.length,
    tailwind: tailwind === null ? null : empreinte(tailwind),
  };
}
const CONTENU_TAILWIND = `/* tailwind de banc ${COURSE} — ne doit JAMAIS être touché */\nwindow.tailwindBanc = true;\n`;

function verifierIntact(avant, contexte) {
  const apres = etatDossier();
  assert.equal(apres.index, avant.index, `${contexte} : le fichier servi (index.html) a été MODIFIÉ (taille ${avant.indexTaille} → ${apres.indexTaille})`);
  assert.equal(apres.tailwind, avant.tailwind, `${contexte} : tailwind.js a été modifié`);
  assert.deepEqual(apres.fichiers, avant.fichiers, `${contexte} : le dossier ne contient plus les mêmes fichiers (fichier temporaire abandonné ?) : ${apres.fichiers.join(', ')}`);
}
function verifierPropre(contexte) {
  const e = etatDossier();
  assert.deepEqual(e.fichiers, ['index.html', 'tailwind.js'], `${contexte} : fichier(s) en trop dans le dossier servi : ${e.fichiers.join(', ')}`);
  assert.ok(e.indexTaille > 0, `${contexte} : index.html est vide ou absent`);
}

/* ─────────────────────  faux GitHub (API + RAW)  ───────────────────── */

async function demarrerFauxGithub({ portApi, portRaw }) {
  const etat = { sha: sha40(), html: '', api: { reponses: [] }, raw: { reponses: [] } };
  const journal = [];
  const servir = async (res, force) => {
    if (force.delaiMs) await dormir(force.delaiMs);
    if (res.socket?.destroyed) return;
    res.writeHead(force.statut ?? 200, { 'content-type': force.type ?? 'text/plain; charset=utf-8' });
    const corps = force.corps ?? '';
    const morceaux = force.morceaux ?? 1;
    if (morceaux <= 1) { res.end(corps); return; }
    const pas = Math.ceil(corps.length / morceaux);
    for (let i = 0; i < corps.length; i += pas) {
      if (res.socket?.destroyed) return;
      res.write(corps.slice(i, i + pas));
      await dormir(force.espaceMs ?? 30);
    }
    res.end();
  };
  const api = http.createServer((req, res) => {
    journal.push({ serveur: 'api', chemin: req.url, date: Date.now() });
    const force = etat.api.reponses.shift();
    if (force) return servir(res, force);
    if (req.method === 'GET' && req.url === `/repos/${DEPOT}/branches/master`) {
      return servir(res, { type: 'application/json; charset=utf-8', corps: JSON.stringify({ name: 'master', commit: { sha: etat.sha, url: `http://127.0.0.1:${portApi}/repos/${DEPOT}/commits/${etat.sha}` }, protected: false }) });
    }
    return servir(res, { statut: 404, type: 'application/json', corps: JSON.stringify({ message: 'Not Found' }) });
  });
  const raw = http.createServer((req, res) => {
    journal.push({ serveur: 'raw', chemin: req.url, date: Date.now() });
    const force = etat.raw.reponses.shift();
    if (force) return servir(res, force);
    if (req.method === 'GET' && req.url === `/${DEPOT}/${etat.sha}/FadeBeat.html`) return servir(res, { corps: etat.html });
    return servir(res, { statut: 404, corps: '404: Not Found' });
  });
  const ecouter = (srv, port) => new Promise((ok, ko) => { srv.once('error', ko); srv.listen(port, '127.0.0.1', () => { srv.off('error', ko); ok(); }); });
  const couper = (srv) => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); });
  await ecouter(api, portApi);
  await ecouter(raw, portRaw);
  return {
    etat, journal,
    urlApi: `http://127.0.0.1:${portApi}`, urlRaw: `http://127.0.0.1:${portRaw}`,
    requetes: (serveur, depuis = 0) => journal.filter((j) => j.serveur === serveur && j.date >= depuis),
    couperApi: () => couper(api), rouvrirApi: () => ecouter(api, portApi),
    couperRaw: () => couper(raw), rouvrirRaw: () => ecouter(raw, portRaw),
    fermer: async () => { await couper(api); await couper(raw); },
  };
}

/* ─────────────  faux courrier : STARTTLS + AUTH, en mémoire  ───────────── */

function demarrerFauxCourrier({ port, cle, cert }) {
  const messages = [];
  const brancher = (flux, chiffre) => {
    let dansDonnees = false; let message = []; let enveloppe = { de: null, vers: [] }; let reste = ''; let etapeAuth = 0;
    const rep = (l) => { try { flux.write(l + '\r\n'); } catch { /* fermé */ } };
    if (!chiffre) rep('220 banc-essai.local ESMTP');
    const traiter = (ligne) => {
      if (dansDonnees) {
        if (ligne === '.') {
          dansDonnees = false;
          messages.push({ date: Date.now(), de: enveloppe.de, vers: enveloppe.vers.slice(), chiffre, brut: message.join('\n') });
          message = []; rep('250 2.0.0 Ok: message enregistre');
        } else message.push(ligne);
        return;
      }
      if (etapeAuth === 1) { etapeAuth = 2; rep('334 UGFzc3dvcmQ6'); return; }
      if (etapeAuth === 2 || etapeAuth === 3) { etapeAuth = 0; rep('235 2.7.0 Authentication successful'); return; }
      const c = ligne.toUpperCase();
      if (c.startsWith('EHLO') || c.startsWith('HELO')) {
        rep('250-banc-essai.local');
        if (!chiffre) rep('250-STARTTLS');
        rep('250-AUTH PLAIN LOGIN');
        rep('250 SIZE 10485760');
      } else if (c === 'STARTTLS') {
        if (chiffre) { rep('503 5.5.1 déjà chiffré'); return; }
        rep('220 2.0.0 Ready to start TLS');
        flux.removeAllListeners('data');
        const sec = new tls.TLSSocket(flux, { isServer: true, key: cle, cert });
        sec.on('error', () => {});
        brancher(sec, true);
      } else if (c.startsWith('AUTH PLAIN')) {
        if (c.trim() === 'AUTH PLAIN') { etapeAuth = 3; rep('334 '); } else rep('235 2.7.0 Authentication successful');
      } else if (c.startsWith('AUTH LOGIN')) { etapeAuth = 1; rep('334 VXNlcm5hbWU6'); }
      else if (c.startsWith('MAIL FROM')) { enveloppe.de = ligne.slice(ligne.indexOf(':') + 1).trim(); rep('250 2.1.0 Ok'); }
      else if (c.startsWith('RCPT TO')) {
        const dest = ligne.slice(ligne.indexOf(':') + 1).trim();
        if (/@(chalou\.link|tonik\.ink)>?$/i.test(dest)) { enveloppe.vers.push(dest); rep('250 2.1.5 Ok'); } else rep('554 5.7.1 Relay access denied');
      } else if (c === 'DATA') { dansDonnees = true; rep('354 Envoyez'); }
      else if (c === 'QUIT') { rep('221 2.0.0 Au revoir'); flux.end(); }
      else if (c === 'RSET') { enveloppe = { de: null, vers: [] }; rep('250 2.0.0 Ok'); }
      else rep('250 2.0.0 Ok');
    };
    flux.on('data', (paquet) => {
      reste += paquet.toString('utf8');
      let coupure;
      while ((coupure = reste.indexOf('\r\n')) !== -1) {
        const ligne = reste.slice(0, coupure); reste = reste.slice(coupure + 2);
        traiter(ligne);
        if (flux.listenerCount('data') === 0) { reste = ''; break; }  /* STARTTLS : la suite est chiffrée */
      }
    });
    flux.on('error', () => {});
  };
  const serveur = net.createServer((flux) => brancher(flux, false));
  return new Promise((ok, ko) => {
    serveur.once('error', ko);
    serveur.listen(port, '127.0.0.1', () => ok({
      messages,
      depuis: (t) => messages.filter((m) => m.date >= t),
      fermer: () => new Promise((r) => serveur.close(() => r())),
    }));
  });
}

function decoderQP(texte) {
  const plat = texte.replace(/=\r?\n/g, '');
  const octets = [];
  for (let i = 0; i < plat.length; i++) {
    if (plat[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(plat.slice(i + 1, i + 3))) { octets.push(parseInt(plat.slice(i + 1, i + 3), 16)); i += 2; }
    else for (const o of Buffer.from(plat[i], 'utf8')) octets.push(o);
  }
  return Buffer.from(octets).toString('utf8');
}
const texteCourrier = (m) => {
  let t = decoderQP(m.brut);
  for (const bloc of m.brut.match(/^(?:[A-Za-z0-9+/]{40,}={0,2}\n)+/gm) ?? []) { try { t += '\n' + Buffer.from(bloc.replace(/\n/g, ''), 'base64').toString('utf8'); } catch { /* pas du base64 */ } }
  return t;
};

/* ─────────────────  lancer le service dans un état donné  ───────────────── */

const enfants = [];
process.on('exit', () => { for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* rien */ } } });

function portOccupe(port) {
  return new Promise((r) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); r(true); });
    s.on('error', () => r(false));
    setTimeout(() => { s.destroy(); r(false); }, 800);
  });
}
async function portLibre(base) {
  for (let p = base; p < base + 80; p++) if (!(await portOccupe(p))) return p;
  throw new Error('aucun port libre');
}

/* Le module préchargé : redirige UNIQUEMENT le port 587 vers le faux courrier. */
const PRECHARGE = (portCourrier) => 'data:text/javascript,' + encodeURIComponent(`
import net from 'node:net';
const P = ${portCourrier};
const orig = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...a) {
  const r = (o) => (o && typeof o === 'object' && Number(o.port) === 587) ? { ...o, port: P } : o;
  if (Array.isArray(a[0])) { a[0][0] = r(a[0][0]); }
  else if (a[0] && typeof a[0] === 'object') { a[0] = r(a[0]); }
  else if (Number(a[0]) === 587) { a[0] = P; }
  return orig.apply(this, a);
};
`);

let PORT_SERVICE = 0;
let PORT_COURRIER = 0;
let PORT_MORT = 0;
let github = null;
let courrier = null;
let service = null;
let CHEMIN_CERT = '';

async function lancerService(nom, modifs = {}) {
  const port = await portLibre(3500 + Math.floor(Math.random() * 400));
  const conf = {
    NODE_ENV: 'production', PORT: String(port),
    MONGO_URL: `mongodb://127.0.0.1:${PORT_MORT}/chalou_banc?serverSelectionTimeoutMS=1500&connectTimeoutMS=1500`, MONGO_DB: 'chalou_banc',
    SMTP_HOST: 'localhost', SMTP_PORT: '587', SMTP_USER: 'banc',
    SMTP_PASS: 'banc-mdp',  // SECRET-EN-ARGUMENT-CITE: faux courrier de banc, valeur factice acceptée quelle qu'elle soit
    MAIL_FROM: 'site@chalou.link', MAIL_TO: 'charles@chalou.link',
    DELAI_MINIMAL_MS: '3000', CONSERVATION_MOIS: '24',
    GITHUB_WEBHOOK_SECRET_FILE: CHEMIN_CLE_PARTAGEE,  // SECRET-EN-ARGUMENT-CITE: nom du réglage ; la valeur est un chemin de banc
    FADEBEAT_DOSSIER: DOSSIER_FADEBEAT,
    GITHUB_API_BASE: github.urlApi, GITHUB_RAW_BASE: github.urlRaw,
    ...modifs,
  };
  for (const [k, v] of Object.entries(conf)) if (v === null) delete conf[k];
  const chemin = path.join(BAC, `reglages-${nom}.conf`);
  fs.writeFileSync(chemin, Object.entries(conf).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  const proc = spawn(process.execPath, [`--env-file=${chemin}`, `--import=${PRECHARGE(PORT_COURRIER)}`, 'server/src/server.js'], {
    cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_EXTRA_CA_CERTS: CHEMIN_CERT },
  });
  enfants.push(proc);
  let sortie = '';
  const journal = fs.createWriteStream(path.join(BAC, `service-${nom}.log`), { flags: 'a' });
  proc.stdout.on('data', (d) => { sortie += d.toString(); journal.write(d); });
  proc.stderr.on('data', (d) => { sortie += d.toString(); journal.write(d); });
  let codeSortie = null;
  proc.on('exit', (c) => { codeSortie = c; });
  const vivant = await jusqua(async () => {
    if (codeSortie !== null) return 'mort';
    const r = await envoyer('GET', '/api/sante', undefined, { port, timeoutMs: 2500 });
    return r.statut === 200 ? 'vivant' : false;
  }, 20000, 300);
  return {
    port, demarre: vivant === 'vivant',
    codeSortie: () => codeSortie, sortie: () => sortie,
    arreter: () => { try { proc.kill('SIGKILL'); } catch { /* rien */ } },
  };
}

/* Déploie « pour de vrai » sur le banc : GitHub porte (sha, html), on pousse. */
async function pousser(sha, html, opts = {}) {
  github.etat.sha = sha;
  github.etat.html = html;
  return livrer(push(opts.after ?? sha), opts);
}
const indexPorte = (sha, ms = 8000) =>
  jusqua(() => { try { return fs.readFileSync(path.join(DOSSIER_FADEBEAT, 'index.html'), 'utf8').includes(sha) ? true : null; } catch { return null; } }, ms, 100);

/* Ce que le fichier servi doit être après un déploiement du sha donné. */
function verifierDeploye(html, sha, contexte) {
  const deploye = fs.readFileSync(path.join(DOSSIER_FADEBEAT, 'index.html'), 'utf8');
  assert.ok(!deploye.includes('cdn.tailwindcss.com'), `${contexte} : le fichier servi référence encore le CDN Tailwind`);
  assert.ok(deploye.includes(LIGNE_LOCALE), `${contexte} : la ligne ${LIGNE_LOCALE} est absente du fichier servi`);
  const ou = deploye.indexOf(sha);
  assert.ok(ou >= 0, `${contexte} : le sha déployé (${sha}) n'apparaît pas dans le fichier servi`);
  assert.ok(ou < 1024, `${contexte} : le sha est à l'octet ${ou}, pas « près du haut »`);
  const commentaires = deploye.match(/<!--[\s\S]*?-->/g) ?? [];
  assert.ok(commentaires.some((c) => c.includes(sha)), `${contexte} : le sha n'est pas dans un commentaire HTML`);
  assert.equal(sansCommentaire(deploye, sha).trim(), transformeAttendu(html).trim(),
    `${contexte} : hors la ligne Tailwind et le commentaire du sha, le contenu servi diffère de ce que GitHub rend`);
}

/* ─────────────────────────  mise en place  ───────────────────────── */

before(async () => {
  fs.mkdirSync(DOSSIER_FADEBEAT, { recursive: true });
  fs.writeFileSync(CHEMIN_CLE_PARTAGEE, `${CLE_PARTAGEE}\n${SECONDE_LIGNE}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(DOSSIER_FADEBEAT, 'index.html'), fabriquerHtml({ marque: `ANCIENNE-VERSION-${COURSE}`, taille: 30_000 }).replace(LIGNE_CDN, LIGNE_LOCALE));
  fs.writeFileSync(path.join(DOSSIER_FADEBEAT, 'tailwind.js'), CONTENU_TAILWIND);

  /* Certificat jetable pour le STARTTLS du faux courrier. */
  const cle = path.join(BAC, 'banc-tls-cle');
  CHEMIN_CERT = path.join(BAC, 'banc-tls-cert');
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cle, '-out', CHEMIN_CERT, '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  assert.equal(r.status, 0, 'openssl indisponible : impossible de fabriquer le certificat du faux courrier');
  fs.chmodSync(cle, 0o600);

  PORT_MORT = await portLibre(27600);
  PORT_COURRIER = await portLibre(2600 + Math.floor(Math.random() * 200));
  const portApi = await portLibre(4600 + Math.floor(Math.random() * 200));
  const portRaw = await portLibre(portApi + 1);
  github = await demarrerFauxGithub({ portApi, portRaw });
  courrier = await demarrerFauxCourrier({ port: PORT_COURRIER, cle: fs.readFileSync(cle), cert: fs.readFileSync(CHEMIN_CERT) });

  service = await lancerService('principal');
  PORT_SERVICE = service.port;
  if (!service.demarre) throw new Error(`le service ne démarre pas sur le banc (code ${service.codeSortie()}) :\n${service.sortie().slice(0, 1500)}`);
});

after(async () => {
  for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* rien */ } }
  await github?.fermer().catch(() => {});
  await courrier?.fermer().catch(() => {});
  /* On ne laisse ni clé partagée ni clé TLS traîner ; journaux et dossier restent pour lecture. */
  for (const f of ['cle-partagee-webhook', 'cle-vide', 'banc-tls-cle']) { try { fs.unlinkSync(path.join(BAC, f)); } catch { /* rien */ } }
  for (const f of fs.readdirSync(BAC)) if (f.startsWith('reglages-')) fs.unlinkSync(path.join(BAC, f));
  try { fs.chmodSync(path.join(BAC, 'lecture-seule'), 0o755); } catch { /* rien */ }
});

/* Commun à presque tous les cas d'échec attendu : 5xx, fichier intact, alerte partie. */
async function verifierRefusAvecAlerte(r, avant, depuisCourrier, contexte) {
  assert.equal(r.silence, false, `${contexte} : aucune réponse (${r.erreur})`);
  assert.ok(r.ms < 10000, `${contexte} : réponse en ${r.ms} ms — GitHub coupe à 10 s et notera un échec`);
  verifierIntact(avant, contexte);
  assert.ok(r.statut >= 500 && r.statut < 600, `${contexte} : réponse ${r.statut} au lieu d'un 5xx (GitHub ne verra pas l'échec et Charles non plus)`);
  const alerte = await jusqua(() => (courrier.depuis(depuisCourrier).length ? courrier.depuis(depuisCourrier) : null), 9000);
  assert.ok(alerte, `${contexte} : AUCUN courriel d'alerte n'est parti — l'échec est SILENCIEUX`);
  assert.ok(alerte.some((m) => m.vers.some((v) => v.includes('charles@chalou.link'))), `${contexte} : l'alerte ne va pas à Charles : ${alerte.map((m) => m.vers.join(',')).join(' | ')}`);
  await dormir(1200);
  verifierIntact(avant, `${contexte} (après un délai)`);
  verifierPropre(contexte);
}

/* ═══════════════════════════════════════════════════════════════════
 *   I. CE QUI NE DOIT JAMAIS PASSER
 * ═══════════════════════════════════════════════════════════════════ */

describe('INTERDITS — signature', () => {
  const corpsRef = () => JSON.stringify(push(sha40()));
  const formes = [
    ['sans signature', () => ({ sansSignature: true })],
    ['signature fausse de bonne longueur', () => ({ signature: 'sha256=' + randomBytes(32).toString('hex') })],
    ['signature trop courte', () => ({ signature: 'sha256=abcdef0123' })],
    ['signature trop longue', (c) => ({ signature: signer(c) + 'ab' })],
    ['signature vide', () => ({ signature: '' })],
    ['signée avec une autre clé', () => ({ cle: 'une-autre-cle-' + COURSE })],
    ['signée avec TOUT le fichier (deux lignes) au lieu de la première ligne', () => ({ cle: `${CLE_PARTAGEE}\n${SECONDE_LIGNE}\n` })],
    ['signée avec la première ligne suivie de sa fin de ligne', () => ({ cle: `${CLE_PARTAGEE}\n` })],
    ['signée sur un AUTRE corps que celui reçu', () => ({ signature: signer(JSON.stringify(push(sha40()))) })],
    ['signature en sha1= (ancien schéma)', (c) => ({ signature: 'sha1=' + createHmac('sha1', CLE_PARTAGEE).update(c).digest('hex') })],
    ['bon HMAC sans le préfixe sha256=', (c) => ({ signature: signer(c).slice(7) })],
    ['HMAC juste mais dans l\'en-tête X-Hub-Signature (hérité) seulement', (c) => ({ sansSignature: true, entetes: { 'x-hub-signature': signer(c) } })],
  ];
  for (const [nom, opts] of formes) {
    test(`S — ${nom} : 401, rien d'écrit, pas de 500`, { timeout: 30000 }, async () => {
      const avant = etatDossier();
      const c = corpsRef();
      github.etat.sha = sha40(); github.etat.html = fabriquerHtml({ marque: 'INTRUS' });
      const requetesAvant = github.journal.length;
      const r = await livrer(c, opts(c));
      assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
      assert.ok(r.ms < 10000, `réponse en ${r.ms} ms`);
      await dormir(700);
      verifierIntact(avant, `« ${nom} »`);
      assert.notEqual(r.statut, 500, `« ${nom} » : réponse 500 — une requête forgée fait crier le serveur`);
      assert.equal(r.statut, 401, `« ${nom} » : réponse ${r.statut} au lieu de 401`);
      assert.equal(github.journal.length, requetesAvant, `« ${nom} » : le service a quand même interrogé GitHub (${github.journal.slice(requetesAvant).map((j) => j.serveur + j.chemin).join(', ')})`);
    });
  }
});

describe('INTERDITS — événement, branche, dépôt', () => {
  const cas = [
    ['événement release (corps de push)', () => push(github.etat.sha), { evenement: 'release' }],
    ['événement pull_request', () => push(github.etat.sha), { evenement: 'pull_request' }],
    ['événement create', () => push(github.etat.sha), { evenement: 'create' }],
    ['événement PUSH en majuscules', () => push(github.etat.sha), { evenement: 'PUSH' }],
    ['sans en-tête X-GitHub-Event', () => push(github.etat.sha), { sansEvenement: true }],
    ['ping signé', () => ping(), { evenement: 'ping' }],
    ['push sur refs/heads/main', () => push(github.etat.sha, { ref: 'refs/heads/main' })],
    ['push sur refs/heads/master2', () => push(github.etat.sha, { ref: 'refs/heads/master2' })],
    ['push sur refs/heads/master/sous-branche', () => push(github.etat.sha, { ref: 'refs/heads/master/sous-branche' })],
    ['push sur le TAG refs/tags/master', () => push(github.etat.sha, { ref: 'refs/tags/master' })],
    ['push sur ref « master » nue', () => push(github.etat.sha, { ref: 'master' })],
    ['push sans ref', () => { const p = push(github.etat.sha); delete p.ref; return p; }],
    ['push d\'un autre dépôt du même auteur', () => push(github.etat.sha, { repository: depot('charlespierru/FadeBeat-fork') })],
    ['push d\'un fork FadeBeat chez quelqu\'un d\'autre', () => push(github.etat.sha, { repository: depot('quelquun/FadeBeat') })],
    ['push sans repository', () => { const p = push(github.etat.sha); delete p.repository; return p; }],
  ];
  for (const [nom, corps, opts = {}] of cas) {
    test(`E — ${nom} : rien d'écrit, GitHub non sollicité, pas de 500`, { timeout: 30000 }, async () => {
      github.etat.sha = sha40(); github.etat.html = fabriquerHtml({ marque: 'NE-DOIT-PAS-SORTIR' });
      const avant = etatDossier();
      const requetesAvant = github.journal.length;
      const r = await livrer(corps(), opts);
      assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
      assert.ok(r.ms < 10000, `réponse en ${r.ms} ms`);
      await dormir(1500);
      verifierIntact(avant, `« ${nom} »`);
      assert.equal(github.journal.length, requetesAvant, `« ${nom} » : le service a interrogé GitHub (${github.journal.slice(requetesAvant).map((j) => j.serveur + j.chemin).join(', ')})`);
      assert.ok(r.statut < 500, `« ${nom} » : réponse ${r.statut} — un événement légitime mais non concerné fait crier le serveur`);
      verifierPropre(`« ${nom} »`);
    });
  }
});

describe('INTERDITS — ne pas croire le corps', () => {
  test('C1 — le corps annonce un vieux sha, l\'API rend le sommet : c\'est le SOMMET qui est déployé', { timeout: 40000 }, async () => {
    const vieux = sha40();
    const sommet = sha40();
    const html = fabriquerHtml({ marque: `SOMMET-${sommet.slice(0, 8)}`, taille: 45_000 });
    const depuis = Date.now();
    const r = await pousser(sommet, html, { after: vieux });
    assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
    assert.ok(r.statut >= 200 && r.statut < 300, `un push authentique est refusé (${r.statut} ${r.texte})`);
    assert.ok(await indexPorte(sommet), 'le fichier servi ne porte pas le sommet rendu par l\'API');
    verifierDeploye(html, sommet, 'C1');
    const raw = github.requetes('raw', depuis).map((j) => j.chemin);
    assert.ok(raw.some((c) => c.includes(sommet)), `le RAW n'a pas été demandé pour le sommet ${sommet} : ${raw.join(', ')}`);
    assert.ok(!raw.some((c) => c.includes(vieux)), `le service a téléchargé le sha ANNONCÉ PAR LE CORPS (${vieux}) au lieu du sommet réel : ${raw.join(', ')}`);
    assert.ok(github.requetes('api', depuis).length >= 1, 'le service n\'a pas interrogé l\'API : il a cru le corps sur parole');
  });

  test('C2 — un `after` forgé (traversée de chemin) n\'atteint jamais le RAW ni le disque', { timeout: 40000 }, async () => {
    const sommet = sha40();
    const html = fabriquerHtml({ marque: `SOMMET-${sommet.slice(0, 8)}`, taille: 42_000 });
    const depuis = Date.now();
    const r = await pousser(sommet, html, { after: '../../../etc/passwd' });
    assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
    await indexPorte(sommet);
    const raw = github.requetes('raw', depuis).map((j) => j.chemin);
    assert.ok(!raw.some((c) => c.includes('passwd') || c.includes('..')), `le RAW a été demandé avec la valeur forgée du corps : ${raw.join(', ')}`);
    assert.notEqual(r.statut, 500, 'réponse 500 sur un corps forgé mais authentique');
    if (r.statut >= 200 && r.statut < 300) verifierDeploye(html, sommet, 'C2');
    verifierPropre('C2');
  });
});

describe('INTERDITS — ce que GitHub rend est invalide : fichier INCHANGÉ, 5xx, ALERTE', () => {
  const quatreCentQuatre = { statut: 404, type: 'application/json', corps: JSON.stringify({ message: 'Branch not found' }) };
  const invalides = [
    ['pas de ligne CDN', () => ({ html: fabriquerHtml({ marque: 'SANS-CDN', cdn: 0 }) })],
    ['deux lignes CDN', () => ({ html: fabriquerHtml({ marque: 'DEUX-CDN', cdn: 2 }) })],
    ['fichier trop petit (3 Kio)', () => ({ html: fabriquerHtml({ marque: 'PETIT', taille: 3_000 }) })],
    ['fichier d\'exactement 10 Kio moins un octet', () => ({ html: fabriquerHtml({ marque: 'LIMITE', taille: 9_900, ascii: true }).slice(0, 10 * 1024 - 1) })],
    ['fichier trop gros (2,5 Mio)', () => ({ html: fabriquerHtml({ marque: 'ENORME', taille: 2_500_000 }) })],
    ['pas un document HTML (JSON qui contient la ligne CDN)', () => ({ html: JSON.stringify({ message: 'x'.repeat(12_000), cdn: LIGNE_CDN }) })],
    ['pas un document HTML (texte brut de 12 Kio avec la ligne CDN)', () => ({ html: `${LIGNE_CDN}\n` + 'texte '.repeat(2500) })],
    ['RAW répond 200 avec « 404: Not Found »', () => ({ raw: [{ statut: 200, corps: '404: Not Found' }] })],
    ['RAW répond 404 à chaque essai', () => ({ raw: Array(6).fill({ statut: 404, corps: '404: Not Found' }) })],
    ['RAW répond 500', () => ({ raw: Array(6).fill({ statut: 500, corps: 'boum' }) })],
    ['RAW répond 200 vide', () => ({ raw: [{ statut: 200, corps: '' }] })],
    ['sha de l\'API mal formé : « master »', () => ({ api: [{ type: 'application/json', corps: JSON.stringify({ name: 'master', commit: { sha: 'master' } }) }] })],
    ['sha de l\'API de 39 caractères', () => ({ api: [{ type: 'application/json', corps: JSON.stringify({ name: 'master', commit: { sha: sha40().slice(1) } }) }] })],
    ['sha de l\'API avec un caractère hors hexadécimal', () => ({ api: [{ type: 'application/json', corps: JSON.stringify({ name: 'master', commit: { sha: 'g' + sha40().slice(1) } }) }] })],
    ['sha de l\'API en traversée de chemin', () => ({ api: [{ type: 'application/json', corps: JSON.stringify({ name: 'master', commit: { sha: '../../' + sha40().slice(6) } }) }] })],
    ['API sans commit.sha', () => ({ api: [{ type: 'application/json', corps: JSON.stringify({ name: 'master', commit: {} }) }] })],
    ['API répond 404 : la branche master n\'existe plus', () => ({ api: Array(6).fill(quatreCentQuatre) })],
    ['push de SUPPRESSION de master (deleted: true), API 404', () => ({ api: Array(6).fill(quatreCentQuatre), corps: push('0'.repeat(40), { deleted: true }) })],
    ['API répond 500', () => ({ api: Array(6).fill({ statut: 500, corps: 'boum' }) })],
    ['API répond 200 mais pas du JSON', () => ({ api: [{ statut: 200, corps: '<html>maintenance</html>' }] })],
    ['API répond 403 (quota GitHub épuisé)', () => ({ api: Array(6).fill({ statut: 403, type: 'application/json', corps: JSON.stringify({ message: 'API rate limit exceeded' }) }) })],
  ];
  for (const [nom, prepare] of invalides) {
    test(`V — ${nom}`, { timeout: 45000 }, async () => {
      const sha = sha40();
      const p = prepare();
      github.etat.sha = sha;
      github.etat.html = p.html ?? fabriquerHtml({ marque: `VALIDE-${sha.slice(0, 6)}` });
      github.etat.api.reponses = p.api ?? [];
      github.etat.raw.reponses = p.raw ?? [];
      const avant = etatDossier();
      const depuisCourrier = Date.now();
      const r = await livrer(p.corps ?? push(sha));
      try {
        await verifierRefusAvecAlerte(r, avant, depuisCourrier, `« ${nom} »`);
      } finally { github.etat.api.reponses = []; github.etat.raw.reponses = []; }
    });
  }

  test('V — API injoignable (personne n\'écoute)', { timeout: 45000 }, async () => {
    await github.couperApi();
    try {
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'API-MORTE' });
      const avant = etatDossier();
      const depuis = Date.now();
      const r = await livrer(push(sha));
      await verifierRefusAvecAlerte(r, avant, depuis, '« API injoignable »');
    } finally { await github.rouvrirApi(); }
  });

  test('V — RAW injoignable (personne n\'écoute)', { timeout: 45000 }, async () => {
    await github.couperRaw();
    try {
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'RAW-MORT' });
      const avant = etatDossier();
      const depuis = Date.now();
      const r = await livrer(push(sha));
      await verifierRefusAvecAlerte(r, avant, depuis, '« RAW injoignable »');
    } finally { await github.rouvrirRaw(); }
  });

  test('V — RAW qui traîne (12 s à chaque essai) : réponse < 10 s, 5xx, alerte, et PAS d\'écriture tardive', { timeout: 60000 }, async () => {
    const sha = sha40();
    const html = fabriquerHtml({ marque: 'LENT' });
    github.etat.sha = sha; github.etat.html = html;
    /* Lent à CHAQUE essai : un service qui réessaie ne doit pas s'en sortir
     * par une seconde tentative rapide. Le contenu, lui, est valide : c'est
     * bien la lenteur seule qui doit faire refuser. */
    github.etat.raw.reponses = Array(6).fill({ statut: 200, corps: html, delaiMs: 12000 });
    const avant = etatDossier();
    const depuis = Date.now();
    const r = await livrer(push(sha), { timeoutMs: 20000 });
    try {
      assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
      assert.ok(r.ms < 10000, `réponse en ${r.ms} ms : GitHub aura déjà raccroché (10 s) et comptera un échec`);
      verifierIntact(avant, 'RAW lent');
      assert.ok(r.statut >= 500, `réponse ${r.statut} alors que rien n'a pu être déployé dans les temps`);
      const alerte = await jusqua(() => (courrier.depuis(depuis).length ? true : null), 9000);
      assert.ok(alerte, 'RAW lent : aucun courriel d\'alerte — échec SILENCIEUX');
      /* Les réponses lentes finissent par arriver. Elles ne doivent PAS être déployées après coup. */
      await dormir(Math.max(0, 12000 + 4000 - (Date.now() - depuis)));
      verifierIntact(avant, 'RAW lent, 16 s plus tard : ÉCRITURE TARDIVE');
      verifierPropre('RAW lent');
    } finally { github.etat.raw.reponses = []; }
  });

  test('V — ligne CDN d\'une forme voisine (paramètre ?plugins=) : jamais de CDN dans le fichier servi', { timeout: 40000 }, async () => {
    const sha = sha40();
    const html = fabriquerHtml({ marque: 'CDN-VOISIN', ligneCdn: '<script src="https://cdn.tailwindcss.com?plugins=forms"></script>' });
    github.etat.sha = sha; github.etat.html = html;
    const avant = etatDossier();
    const depuis = Date.now();
    const r = await livrer(push(sha));
    assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
    await dormir(2500);
    const servi = fs.readFileSync(path.join(DOSSIER_FADEBEAT, 'index.html'), 'utf8');
    assert.ok(!servi.includes('cdn.tailwindcss.com'), `le fichier SERVI référence le CDN Tailwind (réponse ${r.statut}) : la page charge un script tiers`);
    if (etatDossier().index === avant.index) {
      assert.ok(r.statut >= 500, `refus sans 5xx (${r.statut})`);
      assert.ok(courrier.depuis(depuis).length, 'refus sans courriel d\'alerte');
    }
    verifierPropre('CDN voisin');
  });

  test('V — le fichier servi n\'est jamais vide, tronqué ou absent PENDANT un déploiement, et rien ne traîne après', { timeout: 120000 }, async (t) => {
    const anomalies = [];
    let iterations = 0;
    const vus = [];
    for (let tour = 0; tour < 5; tour++) {
      const sha = sha40();
      const taille = tour % 2 === 0 ? 1_300_000 : 200_000;
      const html = fabriquerHtml({ marque: `ATOMIQUE-${tour}`, taille });
      const avant = etatDossier();
      github.etat.sha = sha; github.etat.html = html;
      github.etat.raw.reponses = [{ statut: 200, corps: html, morceaux: 12, espaceMs: 25 }];
      const fin = Date.now() + 6000;
      /* Un fil à part qui regarde le fichier en boucle serrée, sans dormir :
       * une écriture non atomique dure une poignée de millisecondes. */
      const guetteur = new Worker(`
        const fs = process.getBuiltinModule('node:fs');
        const { workerData, parentPort } = process.getBuiltinModule('node:worker_threads');
        const { chemin, dossier, fin, permis } = workerData;
        let iterations = 0; const anomalies = []; const vus = [];
        const ok = (n) => permis.some(([a, b]) => n >= a && n <= b);
        while (Date.now() < fin) {
          iterations++;
          try { const s = fs.statSync(chemin); if (!ok(s.size) && anomalies.length < 10) anomalies.push('index.html de ' + s.size + ' octets'); }
          catch (e) { if (anomalies.length < 10) anomalies.push('index.html : ' + e.code); }
          if (iterations % 400 === 0) for (const f of fs.readdirSync(dossier)) if (!vus.includes(f)) vus.push(f);
        }
        parentPort.postMessage({ iterations, anomalies, vus });
      `, { eval: true, workerData: { chemin: path.join(DOSSIER_FADEBEAT, 'index.html'), dossier: DOSSIER_FADEBEAT, fin, permis: [[avant.indexTaille, avant.indexTaille], [Buffer.byteLength(html) - 200, Buffer.byteLength(html) + 600]] } });
      const rapport = new Promise((ok) => guetteur.on('message', ok));
      const r = await livrer(push(sha));
      assert.equal(r.silence, false, `tour ${tour} : aucune réponse`);
      await indexPorte(sha);
      const rap = await rapport;
      await guetteur.terminate();
      iterations += rap.iterations;
      for (const a of rap.anomalies) anomalies.push(`tour ${tour} : ${a}`);
      for (const f of rap.vus) if (!vus.includes(f)) vus.push(f);
      assert.ok(r.statut >= 200 && r.statut < 300, `tour ${tour} : déploiement refusé (${r.statut} ${r.texte})`);
      verifierDeploye(html, sha, `tour ${tour}`);
      verifierPropre(`tour ${tour}`);
      github.etat.raw.reponses = [];
    }
    t.diagnostic(`${iterations} observations du fichier servi ; fichiers vus dans le dossier : ${vus.join(', ')}`);
    assert.ok(iterations > 5000, 'le guetteur n\'a presque rien observé : ce cas ne prouverait rien (banc à revoir)');
    assert.deepEqual(anomalies, [], `le fichier servi a été VISIBLE à moitié écrit, vide ou absent :\n${anomalies.join('\n')}`);
  });
});

describe('INTERDITS — dossier, clé partagée, fuites', () => {
  test('D1 — dossier de destination inexistant : 5xx, alerte, service toujours vivant, dossier non créé', { timeout: 90000 }, async (t) => {
    const svc = await lancerService('dossier-absent', { FADEBEAT_DOSSIER: path.join(BAC, 'nexiste-pas', 'fadebeat') });
    try {
      if (!svc.demarre) {
        t.diagnostic(`branche : le service refuse de démarrer (code ${svc.codeSortie()})`);
        assert.ok(/FADEBEAT|dossier|inexist|absent/i.test(svc.sortie()), `refus de démarrer sans explication :\n${svc.sortie().slice(0, 600)}`);
        return;
      }
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'DOSSIER-ABSENT' });
      const depuis = Date.now();
      const r = await livrer(push(sha), { port: svc.port });
      assert.equal(r.silence, false, 'aucune réponse');
      assert.ok(r.statut >= 500, `réponse ${r.statut} alors que rien n'a pu être écrit`);
      assert.ok(await jusqua(() => (courrier.depuis(depuis).length ? true : null), 9000), 'aucun courriel d\'alerte : échec SILENCIEUX');
      assert.ok(!fs.existsSync(path.join(BAC, 'nexiste-pas')), 'le service a CRÉÉ le dossier de destination de sa propre initiative');
      assert.equal((await envoyer('GET', '/api/sante', undefined, { port: svc.port })).statut, 200, 'le service est tombé');
    } finally { svc.arreter(); }
  });

  test('D2 — dossier de destination en lecture seule : fichier intact, 5xx, alerte, service vivant', { timeout: 90000 }, async (t) => {
    const dossier = path.join(BAC, 'lecture-seule');
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, 'index.html'), '<!DOCTYPE html><html>lecture seule</html>');
    fs.chmodSync(dossier, 0o555);
    const svc = await lancerService('lecture-seule', { FADEBEAT_DOSSIER: dossier });
    try {
      if (!svc.demarre) {
        t.diagnostic(`branche : le service refuse de démarrer (code ${svc.codeSortie()})`);
        assert.ok(/FADEBEAT|dossier|écri|ecri|permission|EACCES/i.test(svc.sortie()), `refus de démarrer sans explication :\n${svc.sortie().slice(0, 600)}`);
        return;
      }
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'LECTURE-SEULE' });
      const avant = etatDossier(dossier);
      const depuis = Date.now();
      const r = await livrer(push(sha), { port: svc.port });
      assert.equal(r.silence, false, 'aucune réponse');
      assert.ok(r.statut >= 500, `réponse ${r.statut} alors que rien n'a pu être écrit`);
      assert.equal(etatDossier(dossier).index, avant.index, 'le fichier a changé dans un dossier en lecture seule (?)');
      assert.ok(await jusqua(() => (courrier.depuis(depuis).length ? true : null), 9000), 'aucun courriel d\'alerte : échec SILENCIEUX');
      assert.equal((await envoyer('GET', '/api/sante', undefined, { port: svc.port })).statut, 200, 'le service est tombé');
    } finally { svc.arreter(); fs.chmodSync(dossier, 0o755); }
  });

  test('F1 — fichier de clé partagée absent : refus de démarrer EXPLIQUÉ, ou route fermée sans 500 et sans écriture', { timeout: 90000 }, async (t) => {
    const svc = await lancerService('cle-absente', { GITHUB_WEBHOOK_SECRET_FILE: path.join(BAC, 'cle-qui-nexiste-pas') });  // SECRET-EN-ARGUMENT-CITE: nom du réglage, chemin inexistant voulu
    try {
      if (!svc.demarre) {
        t.diagnostic(`branche : le service refuse de démarrer (code ${svc.codeSortie()})`);
        assert.notEqual(svc.sortie().trim(), '', 'le service meurt SANS RIEN DIRE');
        assert.ok(/secret|GITHUB_WEBHOOK|manqu|absent|introuvable|ENOENT/i.test(svc.sortie()), `refus de démarrer sans explication utilisable :\n${svc.sortie().slice(0, 600)}`);
        return;
      }
      t.diagnostic('branche : le service a DÉMARRÉ sans clé partagée');
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'SANS-CLE' });
      const avant = etatDossier();
      for (const [nom, opts] of [['sans signature', { sansSignature: true }], ['signé avec la vraie clé', {}], ['signé avec une chaîne vide', { cle: '' }]]) {
        const r = await livrer(push(sha), { port: svc.port, ...opts });
        assert.equal(r.silence, false, `${nom} : aucune réponse`);
        assert.notEqual(r.statut, 500, `${nom} : 500`);
        assert.ok(r.statut < 200 || r.statut >= 300, `${nom} : ACCEPTÉ (${r.statut}) alors qu'aucune clé n'est configurée`);
      }
      await dormir(1500);
      verifierIntact(avant, 'sans clé configurée');
    } finally { svc.arreter(); }
  });

  test('F2 — fichier de clé partagée VIDE : tout est refusé, jamais 500, rien d\'écrit', { timeout: 90000 }, async (t) => {
    const vide = path.join(BAC, 'cle-vide');
    fs.writeFileSync(vide, '\n\n', { mode: 0o600 });
    const svc = await lancerService('cle-vide', { GITHUB_WEBHOOK_SECRET_FILE: vide });  // SECRET-EN-ARGUMENT-CITE: nom du réglage, fichier vide voulu
    try {
      if (!svc.demarre) {
        t.diagnostic(`branche : refus de démarrer (code ${svc.codeSortie()})`);
        assert.ok(/secret|GITHUB_WEBHOOK|vide|manqu|absent/i.test(svc.sortie()), `refus de démarrer sans explication :\n${svc.sortie().slice(0, 600)}`);
        return;
      }
      const sha = sha40();
      github.etat.sha = sha; github.etat.html = fabriquerHtml({ marque: 'CLE-VIDE' });
      const avant = etatDossier();
      for (const [nom, opts] of [['signé avec la chaîne vide', { cle: '' }], ['signé avec un retour à la ligne', { cle: '\n' }], ['sans signature', { sansSignature: true }]]) {
        const r = await livrer(push(sha), { port: svc.port, ...opts });
        assert.equal(r.silence, false, `${nom} : aucune réponse`);
        assert.notEqual(r.statut, 500, `${nom} : 500`);
        assert.ok(r.statut < 200 || r.statut >= 300, `${nom} : ACCEPTÉ (${r.statut}) avec une clé vide — n'importe qui peut déployer`);
      }
      await dormir(1500);
      verifierIntact(avant, 'clé vide');
    } finally { svc.arreter(); }
  });
});

describe('INTERDITS — corps bizarres et rafales : jamais 500', () => {
  const corps = [
    ['corps non-JSON, correctement signé', 'ceci n\'est pas du JSON {', {}],
    ['corps non-JSON, non signé', 'ceci n\'est pas du JSON {', { sansSignature: true }],
    ['corps vide, signé sur la chaîne vide', '', {}],
    ['corps vide, non signé', '', { sansSignature: true }],
    ['JSON « null »', 'null', {}],
    ['JSON tableau vide', '[]', {}],
    ['JSON chaîne', '"refs/heads/master"', {}],
    ['objet vide', '{}', {}],
    ['ref non textuelle', JSON.stringify({ ref: { $ne: 1 }, after: sha40(), repository: depot() }), {}],
    ['repository.full_name non textuel', JSON.stringify({ ref: 'refs/heads/master', after: sha40(), repository: { full_name: ['charlespierru/FadeBeat'] } }), {}],
    ['type de contenu text/plain, corps JSON signé', JSON.stringify(ping()), { evenement: 'ping', typeContenu: 'text/plain' }],
    ['type de contenu formulaire (payload=…), signé', 'payload=' + encodeURIComponent(JSON.stringify(ping())), { evenement: 'ping', typeContenu: 'application/x-www-form-urlencoded' }],
    ['JSON avec un octet nul et de l\'UTF-8 cassé, signé', Buffer.concat([Buffer.from('{"ref":"refs/heads/master","x":"'), Buffer.from([0x00, 0xff, 0xfe]), Buffer.from('"}')]), {}],
    ['corps de 2 Mio, signé', JSON.stringify({ ...push(sha40()), bourrage: 'A'.repeat(2 * 1024 * 1024) }), { timeoutMs: 40000 }],
    ['corps de 2 Mio, non signé', JSON.stringify({ ...push(sha40()), bourrage: 'B'.repeat(2 * 1024 * 1024) }), { sansSignature: true, timeoutMs: 40000 }],
  ];
  for (const [nom, c, opts] of corps) {
    test(`B — ${nom}`, { timeout: 60000 }, async () => {
      github.etat.sha = sha40(); github.etat.html = fabriquerHtml({ marque: 'CORPS-BIZARRE' });
      const avant = etatDossier();
      const r = await livrer(c, opts);
      assert.ok(r.ms < 10000, `réponse en ${r.ms} ms`);
      if (r.silence) assert.ok(String(c).length > 1_000_000, `« ${nom} » : connexion coupée sans réponse (${r.erreur})`);
      else assert.ok(r.statut !== 500 && r.statut < 501, `« ${nom} » : réponse ${r.statut} — le corps fait crier le serveur`);
      await dormir(600);
      verifierIntact(avant, `« ${nom} »`);
    });
  }

  test('R1 — 30 pings signés d\'affilée de la même adresse : du 429, jamais de 500, un autre visiteur passe', { timeout: 60000 }, async (t) => {
    const insistant = ipUnique();
    const statuts = [];
    for (let i = 0; i < 30; i++) statuts.push((await livrer(ping(), { evenement: 'ping', ip: insistant })).statut);
    const autre = await livrer(ping(), { evenement: 'ping', ip: ipUnique() });
    t.diagnostic(`statuts : ${statuts.join(' ')}`);
    assert.ok(!statuts.some((s) => s >= 500), `des 5xx dans la rafale : ${statuts.join(' ')}`);
    assert.ok(statuts.some((s) => s === 429), `30 appels en quelques secondes depuis une même adresse : aucun 429 (${statuts.join(' ')}) — la route est sans limite`);
    assert.ok(statuts.slice(0, 5).every((s) => s === 200), `les 5 premiers pings signés ne passent pas tous : ${statuts.slice(0, 5).join(' ')}`);
    assert.equal(autre.statut, 200, `un autre visiteur est freiné par la rafale du premier (${autre.statut})`);
  });

  test('R2 — 30 requêtes NON signées de la même adresse : du 429 aussi, jamais de 500', { timeout: 60000 }, async (t) => {
    const insistant = ipUnique();
    const statuts = [];
    for (let i = 0; i < 30; i++) statuts.push((await livrer(push(sha40()), { sansSignature: true, ip: insistant })).statut);
    t.diagnostic(`statuts : ${statuts.join(' ')}`);
    assert.ok(!statuts.some((s) => s >= 500), `des 5xx dans la rafale : ${statuts.join(' ')}`);
    assert.ok(statuts.some((s) => s === 429), `30 requêtes forgées depuis une même adresse, jamais freinée (${statuts.join(' ')}) : on peut cogner la vérification HMAC sans fin`);
    assert.ok(statuts.every((s) => s === 401 || s === 429), `autre chose que 401/429 : ${statuts.join(' ')}`);
  });
});

/* ═══════════════════════════════════════════════════════════════════
 *   II. TÉMOINS — ce qui doit CONTINUER de fonctionner
 * ═══════════════════════════════════════════════════════════════════ */

describe('TÉMOINS', () => {
  test('T0 — /api/sante répond', async () => {
    const r = await envoyer('GET', '/api/sante');
    assert.equal(r.statut, 200, `/api/sante répond ${r.statut} ${r.erreur ?? ''}`);
  });

  test('T1 — le formulaire de contact marche toujours, et son courrier arrive (témoin du banc courrier)', { timeout: 40000 }, async () => {
    const rep = repere('T1');
    const depuis = Date.now();
    const r = await envoyer('POST', '/api/contact', {
      nom: `Camille Dûrand ${rep}`, courriel: `camille+${rep.toLowerCase()}@example.com`,
      message: `Bonjour Charles, repère ${rep}. Où êtes-vous ? œuf, ça va.`, site: '', ouvertPendant: 9000, langue: 'fr',
    });
    assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
    assert.ok(r.statut >= 200 && r.statut < 300, `formulaire de contact cassé : ${r.statut} ${r.texte}`);
    const m = await jusqua(() => courrier.depuis(depuis).find((x) => texteCourrier(x).includes(rep)) ?? null, 10000);
    assert.ok(m, 'le message du formulaire n\'est jamais arrivé au faux courrier : soit le formulaire est cassé, soit le banc courrier ne capture rien — et alors AUCUNE alerte de ce fichier n\'est prouvable');
    assert.ok(m.chiffre, 'le courrier est parti EN CLAIR (sans STARTTLS)');
  });

  test('T2 — la route existe : un ping signé répond 200', async () => {
    const r = await livrer(ping(), { evenement: 'ping' });
    assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
    assert.equal(r.statut, 200, `ping signé : ${r.statut} ${r.texte}`);
  });

  describe('T3/T4 — un push authentique déploie le sommet, une relivraison redéploie à l\'identique', () => {
    const sha = sha40();
    const html = fabriquerHtml({ marque: `TEMOIN-${sha.slice(0, 8)}`, taille: 60_000 });
    const livraison = randomUUID();
    let r1 = null; let r2 = null; let depuis = 0; let etatApres1 = null; let alertes = 0;

    before(async () => {
      depuis = Date.now();
      r1 = await pousser(sha, html, { livraison });
      await indexPorte(sha);
      etatApres1 = etatDossier();
      r2 = await livrer(push(sha), { livraison });
      await dormir(2000);
      alertes = courrier.depuis(depuis).length;
    });

    test('T3a — accepté en moins de 10 s, fichier conforme, sha en commentaire près du haut', () => {
      assert.equal(r1.silence, false, `aucune réponse (${r1.erreur})`);
      assert.ok(r1.ms < 10000, `réponse en ${r1.ms} ms`);
      assert.ok(r1.statut >= 200 && r1.statut < 300, `push authentique refusé : ${r1.statut} ${r1.texte}`);
      verifierDeploye(html, sha, 'T3');
    });
    test('T3b — tailwind.js n\'a pas bougé, rien ne traîne', () => {
      const e = etatDossier();
      assert.equal(e.tailwind, empreinte(Buffer.from(CONTENU_TAILWIND)), 'tailwind.js a été modifié');
      verifierPropre('T3');
    });
    test('T3c — le journal du service porte le sha déployé et l\'identifiant de livraison', () => {
      const j = service.sortie();
      assert.ok(j.includes(sha), 'le sha déployé n\'est pas dans le journal du service');
      assert.ok(j.includes(livraison), `l'identifiant de livraison ${livraison} n'est pas dans le journal du service`);
    });
    test('T3d — un déploiement réussi ne déclenche pas de courriel d\'alerte', () => {
      assert.equal(alertes, 0, `${alertes} courriel(s) parti(s) pour deux déploiements réussis : l'alerte crie pour rien, on finira par ne plus la lire`);
    });
    test('T4 — la relivraison du même push : 2xx, même contenu servi, pas d\'erreur', (t) => {
      assert.equal(r2.silence, false, `aucune réponse (${r2.erreur})`);
      assert.ok(r2.statut >= 200 && r2.statut < 300, `relivraison refusée : ${r2.statut} ${r2.texte}`);
      assert.ok(r2.ms < 10000, `réponse en ${r2.ms} ms`);
      verifierDeploye(html, sha, 'T4');
      /* Octet pour octet, le fichier peut différer par ce que le service met
       * dans son commentaire (un horodatage, par exemple). Ce n'est pas une
       * faute silencieuse : on le dit, on ne le sanctionne pas. */
      if (etatDossier().index !== etatApres1.index) t.diagnostic('la relivraison a réécrit le fichier avec un commentaire différent (horodatage ?) — contenu servi identique');
    });
  });

  test('T5 — après tous les échecs qui précèdent, un push authentique déploie encore', { timeout: 40000 }, async () => {
    const sha = sha40();
    const html = fabriquerHtml({ marque: `REPRISE-${sha.slice(0, 8)}`, taille: 55_000 });
    const r = await pousser(sha, html);
    assert.ok(r.statut >= 200 && r.statut < 300, `push authentique refusé après la série d'échecs : ${r.statut} ${r.texte}`);
    assert.ok(await indexPorte(sha), 'le fichier n\'est pas redéployé');
    verifierDeploye(html, sha, 'T5');
    verifierPropre('T5');
  });

  test('T6 — RAW répond 404 puis 200 : une nouvelle tentative, et le déploiement aboutit', { timeout: 40000 }, async () => {
    const sha = sha40();
    const html = fabriquerHtml({ marque: `RETENTE-${sha.slice(0, 8)}` });
    github.etat.sha = sha; github.etat.html = html;
    github.etat.raw.reponses = [{ statut: 404, corps: '404: Not Found' }];
    const depuis = Date.now();
    try {
      const r = await livrer(push(sha));
      assert.equal(r.silence, false, `aucune réponse (${r.erreur})`);
      assert.ok(r.ms < 10000, `réponse en ${r.ms} ms`);
      await indexPorte(sha);
      const raw = github.requetes('raw', depuis);
      assert.ok(raw.length >= 2, `un seul essai sur le RAW après un 404 (GitHub met parfois quelques secondes à exposer un commit) — ${raw.length} requête(s)`);
      verifierDeploye(html, sha, 'T6');
      assert.ok(r.statut >= 200 && r.statut < 300, `déployé mais réponse ${r.statut}`);
    } finally { github.etat.raw.reponses = []; }
  });

  test('L1 — la clé partagée n\'apparaît ni dans les réponses, ni dans le journal du service, ni dans les courriels', () => {
    const journal = service.sortie();
    assert.notEqual(journal.trim(), '', 'le service n\'a rien écrit dans son journal : ce cas ne prouverait rien');
    assert.ok(!journal.includes(CLE_PARTAGEE), 'la CLÉ PARTAGÉE est écrite dans le journal du service');
    assert.ok(!journal.includes(SECONDE_LIGNE), 'la seconde ligne du fichier de clé est écrite dans le journal du service');
    for (const r of TOUTES_LES_REPONSES) {
      assert.ok(!r.texte.includes(CLE_PARTAGEE), `la CLÉ PARTAGÉE est dans une réponse HTTP : ${r.texte.slice(0, 200)}`);
      assert.ok(!JSON.stringify(r.entetes).includes(CLE_PARTAGEE), 'la CLÉ PARTAGÉE est dans un en-tête de réponse');
    }
    assert.ok(courrier.messages.length > 0, 'aucun courriel capturé : ce cas ne prouverait rien');
    for (const m of courrier.messages) {
      assert.ok(!texteCourrier(m).includes(CLE_PARTAGEE) && !m.brut.includes(CLE_PARTAGEE), 'la CLÉ PARTAGÉE est dans un courriel');
    }
  });
});
