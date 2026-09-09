/* BANC PARTAGÉ — le courrier de pacotille des épreuves de chalou.link.
 *
 * Ce fichier n'est PAS une épreuve : il ne contient aucun cas. Il porte ce
 * que les deux épreuves (formulaire de contact, webhook FadeBeat) ont en
 * commun pour capturer le courrier que le service croit envoyer :
 *
 *  1. un faux serveur de courrier, en mémoire, qui parle STARTTLS et AUTH
 *     juste assez pour qu'un vrai client croie lui parler — et qui note, pour
 *     chaque message, s'il est arrivé APRÈS l'élévation TLS ;
 *  2. la fabrication d'un certificat jetable (openssl, auto-signé, CN=localhost)
 *     que le service reçoit par NODE_EXTRA_CA_CERTS ;
 *  3. le module préchargé (--import d'une URL data:) qui, dans le service,
 *     dirige UNIQUEMENT les connexions vers le port 587 vers un port choisi :
 *     le port 587 est imposé par config.js et ne peut pas être lié par un
 *     utilisateur ordinaire ;
 *  4. le décodage du courrier reçu (quoted-printable, base64) pour y chercher
 *     un repère.
 *
 * Extrait le 2026-09-10 de epreuve-webhook-fadebeat.test.js (09-09), sans
 * changer une ligne de comportement. Le code du service n'est pas ouvert.
 */

import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* ─────────────  faux courrier : STARTTLS + AUTH, en mémoire  ───────────── */

export function demarrerFauxCourrier({ port, cle, cert }) {
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
        /* On imite le vrai serveur : il n'accepte que ses propres domaines,
         * et refuse de relayer vers l'extérieur. */
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

/* ─────────────────────  décodage du courrier reçu  ───────────────────── */

export function decoderQP(texte) {
  const plat = texte.replace(/=\r?\n/g, '');
  const octets = [];
  for (let i = 0; i < plat.length; i++) {
    if (plat[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(plat.slice(i + 1, i + 3))) { octets.push(parseInt(plat.slice(i + 1, i + 3), 16)); i += 2; }
    else for (const o of Buffer.from(plat[i], 'utf8')) octets.push(o);
  }
  return Buffer.from(octets).toString('utf8');
}

export const texteCourrier = (m) => {
  let t = decoderQP(m.brut);
  for (const bloc of m.brut.match(/^(?:[A-Za-z0-9+/]{40,}={0,2}\n)+/gm) ?? []) { try { t += '\n' + Buffer.from(bloc.replace(/\n/g, ''), 'base64').toString('utf8'); } catch { /* pas du base64 */ } }
  return t;
};

/* ─────────────  certificat jetable pour le STARTTLS du faux courrier  ───────────── */

/* Fabrique une clé et un certificat auto-signé (CN=localhost) dans le bac.
 * Rend les chemins et le contenu ; jette si openssl est indisponible.
 * La clé est à retirer par l'appelant en fin d'épreuve. */
export function fabriquerCertificat(bac) {
  const cheminCle = path.join(bac, 'banc-tls-cle');
  const cheminCert = path.join(bac, 'banc-tls-cert');
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', cheminCle, '-out', cheminCert, '-days', '2',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('openssl indisponible : impossible de fabriquer le certificat du faux courrier');
  fs.chmodSync(cheminCle, 0o600);
  return { cheminCle, cheminCert, cle: fs.readFileSync(cheminCle), cert: fs.readFileSync(cheminCert) };
}

/* ─────────────  module préchargé : le 587 va vers le port choisi  ───────────── */

/* À passer au service par --import. Redirige UNIQUEMENT le port 587 ; rien
 * d'autre n'est touché. Pointé vers un port où personne n'écoute, il joue la
 * panne franche « serveur de courrier injoignable ». */
export const PRECHARGE = (portCourrier) => 'data:text/javascript,' + encodeURIComponent(`
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

/* ─────────────────────  ports  ───────────────────── */

export function portOccupe(port) {
  return new Promise((r) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.on('connect', () => { s.destroy(); r(true); });
    s.on('error', () => r(false));
    setTimeout(() => { s.destroy(); r(false); }, 800);
  });
}
export async function portLibre(base, etendue = 80) {
  for (let p = base; p < base + etendue; p++) if (!(await portOccupe(p))) return p;
  throw new Error('aucun port libre');
}
