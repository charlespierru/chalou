/* ÉPREUVE INDÉPENDANTE — service du formulaire de contact de chalou.link.
 *
 * Écrite à partir du BUT et des INTERDITS, sans lire la logique du service
 * (routes/contact.js et mail.js n'ont pas été ouverts). Seuls ont été relevés :
 * les noms des champs du formulaire (public/js/contact.js), les noms des
 * réglages (config.js, .env.example) et le fait que le courrier part
 * OBLIGATOIREMENT en STARTTLS authentifié sur le port 587 (garde-fou de
 * config.js, 2026-09-08).
 *
 * Cas A1…A12 et T0…T8 écrits le 2026-09-07 ; banc refait le 2026-09-10 sur le
 * modèle de l'épreuve du webhook (09-09), pour être AUTONOME : plus aucun
 * fichier ni service à lancer à la main. Le cas T1bis (courrier parti chiffré)
 * est ajouté à cette occasion.
 *
 * LE BANC, ET SES ARTIFICES (dits franchement) :
 *  1. Le port 587 est imposé par config.js et ne peut pas être lié par un
 *     utilisateur ordinaire. Chaque service est donc lancé avec un module
 *     préchargé (--import, URL data:, fourni par epreuve-banc-courrier.js) qui
 *     ne fait qu'UNE chose : quand le service ouvre une connexion vers le port
 *     587, elle est dirigée vers le port du faux courrier du banc.
 *  2. Le faux courrier parle STARTTLS avec un certificat auto-signé fabriqué à
 *     chaque exécution, donné au service par NODE_EXTRA_CA_CERTS. Il note si
 *     chaque message est arrivé après l'élévation TLS.
 *  3. « Courrier injoignable » (A1, T4) : le service refuse tout port autre
 *     que 587, donc on ne peut plus lui donner un port mort. Le module
 *     préchargé de CES services-là dirige le 587 vers un port où personne
 *     n'écoute : connexion refusée, panne franche, service non modifié.
 *  4. L'archive est une base JETABLE (chalou_banc_<COURSE>) sur le mongod
 *     local sans authentification ; elle est supprimée à la fin. Les cas
 *     « archive morte » gardent un port mort.
 *  5. Le journal du service (A6, A7) est sa sortie, écrite par l'épreuve dans
 *     un fichier du bac.
 *
 * Chaque cas se donne un REPÈRE unique et une ADRESSE SOURCE unique
 * (127.x.y.z, toutes locales) : l'épreuve peut tourner plusieurs fois
 * d'affilée sans se polluer, et deux cas ne se volent jamais leur quota.
 *
 * Lancement : node --test epreuve/epreuve-contact.test.js
 * Réglages facultatifs : EPREUVE_RACINE (racine du projet), EPREUVE_BAC
 * (dossier de banc ; défaut epreuve/bac).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { demarrerFauxCourrier, texteCourrier, fabriquerCertificat, PRECHARGE, portLibre } from './epreuve-banc-courrier.js';

/* ─────────────────────────  le banc  ───────────────────────── */

const RACINE = process.env.EPREUVE_RACINE
  ? path.resolve(process.env.EPREUVE_RACINE)
  : fileURLToPath(new URL('../', import.meta.url));
const COURSE = Math.random().toString(36).slice(2, 7).toUpperCase();
const BAC = path.join(process.env.EPREUVE_BAC ?? path.join(RACINE, 'epreuve/bac'), `contact-${COURSE}`);
const FICHIER_JOURNAL = path.join(BAC, 'service-principal.log');
const CHEMIN_CLE_WEBHOOK = path.join(BAC, 'cle-partagee-webhook');   // SECRET-EN-ARGUMENT-CITE: chemin de banc, valeur aléatoire jetable
const DOSSIER_FADEBEAT = path.join(BAC, 'fadebeat');

const MAIL_TO = 'charles@chalou.link';
const MONGO_URL = 'mongodb://127.0.0.1:27017';
const MONGO_DB = `chalou_banc_${COURSE}`;
/* Une archive morte : un port où personne n'écoute, avec un délai court pour
 * que la panne soit constatée vite (le service n'est pas modifié pour autant). */
const mongoMort = () => `mongodb://127.0.0.1:${PORT_MORT_MONGO}/${MONGO_DB}?serverSelectionTimeoutMS=1500&connectTimeoutMS=1500`;

let compteur = 0;
const repere = (cas) => `EPR-${cas}-${COURSE}-${++compteur}`;

/* Une adresse source neuve par visiteur simulé : tout 127.0.0.0/8 est local. */
const ipUnique = () =>
  `127.${10 + Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 250)}`;

/* ────────────────────────  outils  ──────────────────────── */

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

/* Envoie une requête. Ne jette jamais : un silence est une DONNÉE, pas une
 * exception — c'est la faute la plus grave qu'on cherche. */
function envoyer(methode, chemin, corps, opts = {}) {
  const donnees = corps === undefined ? null : (typeof corps === 'string' ? corps : JSON.stringify(corps));
  const debut = Date.now();
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port ?? PORT_SERVICE,
        path: chemin,
        method: methode,
        family: 4,
        localAddress: opts.ip ?? ipUnique(),
        headers: {
          ...(donnees === null ? {} : { 'content-type': opts.typeContenu ?? 'application/json', 'content-length': Buffer.byteLength(donnees) }),
          ...(opts.entetes ?? {}),
        },
      },
      (rep) => {
        let texte = '';
        rep.setEncoding('utf8');
        rep.on('data', (m) => { texte += m; });
        rep.on('end', () => resolve({ statut: rep.statusCode, entetes: rep.headers, texte, ms: Date.now() - debut, silence: false }));
      },
    );
    req.setTimeout(opts.timeoutMs ?? 25000, () => req.destroy(new Error('AUCUNE RÉPONSE (délai dépassé)')));
    req.on('error', (e) => resolve({ statut: 0, entetes: {}, texte: '', erreur: e.message, ms: Date.now() - debut, silence: true }));
    if (donnees !== null) req.write(donnees);
    req.end();
  });
}

const messageHonnete = (rep, extra = {}) => ({
  nom: `Camille Dûrand ${rep}-NOM`,
  courriel: `camille.durand+${rep.toLowerCase()}@example.com`,
  message: `Bonjour Charles, j'ai pris le temps d'écrire ceci — ça compte. Repère ${rep}. Où êtes-vous ? œuf, ça va.`,
  site: '',
  ouvertPendant: 9000,
  langue: 'fr',
  ...extra,
});

/* ─────────────────  lecture du courrier réellement parti  ───────────────── */

/* Le faux courrier garde chaque message en mémoire : { date, de, vers[],
 * chiffre, brut }. On y ajoute le texte décodé pour y chercher un repère. */
let courrier = null;
const bloc = (m) => ({ ...m, decode: texteCourrier(m), destinataires: m.vers.join(', ') });
const blocsCourrier = (depuis = 0) => courrier.depuis(depuis).map(bloc);
const courrierDe = (rep) => blocsCourrier().find((b) => b.decode.includes(rep)) ?? null;
const attendreCourrier = (rep, ms = 8000) => jusqua(async () => courrierDe(rep), ms);
/* Les en-têtes d'un message : tout ce qui précède la première ligne vide. */
const entetesDe = (b) => b.brut.split(/\n\s*\n/)[0] ?? '';

/* ─────────────────────  lecture de l'archive  ───────────────────── */

let clientMongo = null;
async function docsRecents() {
  if (!clientMongo) {
    clientMongo = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 4000 });
    await clientMongo.connect();
  }
  return clientMongo.db(MONGO_DB).collection('messages').find({}).sort({ _id: -1 }).limit(400).toArray();
}
async function archiveDe(rep) {
  const docs = await docsRecents();
  return docs.find((d) => JSON.stringify(d).includes(rep)) ?? null;
}
const attendreArchive = (rep, ms = 8000) => jusqua(() => archiveDe(rep), ms);

/* ─────────────────  lancer un service dans un état donné  ───────────────── */

const enfants = [];
function arreterTout() {
  for (const e of enfants) { try { e.kill('SIGKILL'); } catch { /* déjà mort */ } }
  enfants.length = 0;
}
process.on('exit', arreterTout);

let PORT_SERVICE = 0;
let PORT_COURRIER = 0;
let PORT_MORT_SMTP = 0;    /* un port sur lequel personne n'écoute : panne franche du courrier */
let PORT_MORT_MONGO = 0;   /* idem pour l'archive */
let CHEMIN_CERT = '';
let service = null;

/* Écrit un fichier de réglages dérivé du banc et démarre le service dessus.
 * Rend TOUJOURS la main : si le service ne démarre pas, on le dit.
 * opts.portCourrier : où le 587 est dirigé pour CE service (défaut : le faux
 * courrier ; un port mort pour jouer « courrier injoignable »). */
async function lancerService(nom, modifs = {}, opts = {}) {
  const port = await portLibre(3400 + Math.floor(Math.random() * 300));
  const conf = {
    NODE_ENV: 'production', PORT: String(port),
    MONGO_URL, MONGO_DB,
    SMTP_HOST: 'localhost', SMTP_PORT: '587', SMTP_USER: 'banc',
    SMTP_PASS: 'banc-mdp',  // SECRET-EN-ARGUMENT-CITE: faux courrier de banc, valeur factice acceptée quelle qu'elle soit
    MAIL_FROM: 'site@chalou.link', MAIL_TO,
    DELAI_MINIMAL_MS: '3000', CONSERVATION_MOIS: '24',
    GITHUB_WEBHOOK_SECRET_FILE: CHEMIN_CLE_WEBHOOK,  // SECRET-EN-ARGUMENT-CITE: nom du réglage ; la valeur est un chemin de banc
    FADEBEAT_DOSSIER: DOSSIER_FADEBEAT,
    ...modifs,
  };
  for (const [k, v] of Object.entries(conf)) if (v === null) delete conf[k];
  const chemin = path.join(BAC, `reglages-${nom}.conf`);
  fs.writeFileSync(chemin, Object.entries(conf).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });

  const proc = spawn(process.execPath, [`--env-file=${chemin}`, `--import=${PRECHARGE(opts.portCourrier ?? PORT_COURRIER)}`, 'server/src/server.js'], {
    cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_EXTRA_CA_CERTS: CHEMIN_CERT },
  });
  enfants.push(proc);
  let sortie = '';
  /* Le journal du service : sa sortie, écrite dans le bac de façon synchrone
   * pour que les cas A6/A7 lisent un fichier à jour. */
  const journal = path.join(BAC, `service-${nom}.log`);
  fs.writeFileSync(journal, '');
  const noter = (d) => { sortie += d.toString(); fs.appendFileSync(journal, d); };
  proc.stdout.on('data', noter);
  proc.stderr.on('data', noter);
  let codeSortie = null;
  proc.on('exit', (c) => { codeSortie = c; });

  const vivant = await jusqua(async () => {
    if (codeSortie !== null) return 'mort';
    const r = await envoyer('GET', '/api/sante', undefined, { port, timeoutMs: 2500 });
    return r.statut === 200 ? 'vivant' : false;
  }, 18000, 400);

  return {
    port, chemin, journal,
    demarre: vivant === 'vivant',
    codeSortie: () => codeSortie,
    sortie: () => sortie,
    arreter: () => { try { proc.kill('SIGKILL'); } catch { /* rien */ } },
  };
}

/* ─────────────────────────  mise en place  ───────────────────────── */

before(async () => {
  fs.mkdirSync(DOSSIER_FADEBEAT, { recursive: true });
  /* Le service exige un secret de webhook (première ligne ≥ 16 signes) et un
   * dossier FadeBeat, même si cette épreuve ne les exerce pas. */
  fs.writeFileSync(CHEMIN_CLE_WEBHOOK, `banc-${COURSE}-${randomBytes(20).toString('hex')}\n`, { mode: 0o600 });

  const certificat = fabriquerCertificat(BAC);
  CHEMIN_CERT = certificat.cheminCert;

  PORT_MORT_SMTP = await portLibre(2600);
  PORT_MORT_MONGO = await portLibre(27600);
  PORT_COURRIER = await portLibre(2700 + Math.floor(Math.random() * 200));
  courrier = await demarrerFauxCourrier({ port: PORT_COURRIER, cle: certificat.cle, cert: certificat.cert });

  /* L'archive de banc doit être joignable, sinon la moitié des cas ne prouve rien. */
  await docsRecents().catch((e) => { throw new Error(`mongod local injoignable sur ${MONGO_URL} : ${e.message}`); });

  service = await lancerService('principal');
  PORT_SERVICE = service.port;
  if (!service.demarre) throw new Error(`le service ne démarre pas sur le banc (code ${service.codeSortie()}) :\n${service.sortie().slice(0, 1500)}`);
});

after(async () => {
  arreterTout();
  await courrier?.fermer().catch(() => {});
  /* La base jetable de cette exécution disparaît avec elle. */
  if (clientMongo) {
    await clientMongo.db(MONGO_DB).dropDatabase().catch(() => {});
    await clientMongo.close().catch(() => {});
  }
  /* On ne laisse traîner ni clé, ni réglages ; journaux restent pour lecture. */
  for (const f of ['cle-partagee-webhook', 'banc-tls-cle']) { try { fs.unlinkSync(path.join(BAC, f)); } catch { /* rien */ } }
  for (const f of fs.readdirSync(BAC)) if (f.startsWith('reglages-')) fs.unlinkSync(path.join(BAC, f));
});

/* ═══════════════════════════════════════════════════════════════════
 *   I. CE QUI NE DOIT JAMAIS PASSER
 * ═══════════════════════════════════════════════════════════════════ */

describe('INTERDITS', () => {

  test("A1 — ne jamais dire « reçu » quand ni le courrier ni la copie n'ont abouti", { timeout: 150000 }, async (t) => {
    /* Courrier injoignable : le 587 de CE service mène à un port mort. */
    const svc = await lancerService('sourd-et-muet', { MONGO_URL: mongoMort() }, { portCourrier: PORT_MORT_SMTP });
    try {
      if (!svc.demarre) {
        t.diagnostic(`branche : le service refuse de démarrer (code ${svc.codeSortie()})`);
        /* Refuser de démarrer est une réponse acceptable — à condition de
         * CRIER. Mourir en silence est la faute la plus grave. */
        assert.notEqual(svc.sortie().trim(), '',
          "le service n'a pas démarré ET n'a rien dit : panne silencieuse");
        return;
      }
      const rep = repere('A1');
      const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      assert.equal(r.silence, false, `pas de réponse du tout : ${r.erreur}`);
      assert.ok(r.statut < 200 || r.statut >= 300,
        `le service a répondu ${r.statut} ${r.texte} alors que le courrier ET l'archive sont injoignables : le visiteur croit son message parti, il n'est nulle part`);
      await dormir(1500);
      assert.equal(courrierDe(rep), null, 'rien ne devait partir');
    } finally { svc.arreter(); }
  });

  test("A1bis — courrier REFUSÉ par le serveur + archive morte : ne jamais dire « reçu »", { timeout: 150000 }, async (t) => {
    /* Panne plus sournoise qu'une panne franche : le serveur de courrier
     * répond, dialogue, puis refuse le destinataire (554). Un service qui ne
     * lit que « la connexion a marché » croira le message parti. */
    const svc = await lancerService('destinataire-refuse', {
      MAIL_TO: 'quelquun@ailleurs-non-relaye.example',
      MONGO_URL: mongoMort(),
    });
    try {
      if (!svc.demarre) {
        t.diagnostic('le service refuse de démarrer dans cet état');
        assert.notEqual(svc.sortie().trim(), '', "le service ne démarre pas ET ne dit rien");
        return;
      }
      const rep = repere('A1bis');
      const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      assert.equal(r.silence, false, `pas de réponse du tout : ${r.erreur}`);
      assert.ok(r.statut < 200 || r.statut >= 300,
        `le destinataire est refusé par le serveur de courrier et l'archive est morte, mais le service répond ${r.statut} « ${r.texte} » : le message n'est nulle part et le visiteur croit l'avoir envoyé`);
    } finally { svc.arreter(); }
  });

  test('A2 — le champ leurre rempli : rien ne part, rien ne s\'archive', async () => {
    const rep = repere('A2');
    const r = await envoyer('POST', '/api/contact', messageHonnete(rep, { site: 'http://achat-de-liens.example' }));
    assert.equal(r.silence, false, 'pas de réponse');
    await dormir(2500);
    assert.equal(courrierDe(rep), null, `un automate (leurre rempli) a fait partir un courrier — réponse ${r.statut}`);
    assert.equal(await archiveDe(rep), null, 'un automate (leurre rempli) a été archivé');
  });

  test('A3 — formulaire rempli en un clin d\'œil : rien ne part, rien ne s\'archive', async () => {
    const rep = repere('A3');
    const r = await envoyer('POST', '/api/contact', messageHonnete(rep, { ouvertPendant: 120 }));
    assert.equal(r.silence, false, 'pas de réponse');
    await dormir(2500);
    assert.equal(courrierDe(rep), null, `un automate (120 ms de remplissage) a fait partir un courrier — réponse ${r.statut}`);
    assert.equal(await archiveDe(rep), null, 'un automate (120 ms de remplissage) a été archivé');
  });

  test("A4 — l'automate qui ne fournit aucune preuve de délai ne passe pas", async () => {
    const sans = repere('A4sans');
    const corpsSans = messageHonnete(sans);
    delete corpsSans.ouvertPendant;
    const r1 = await envoyer('POST', '/api/contact', corpsSans);

    const neg = repere('A4neg');
    const r2 = await envoyer('POST', '/api/contact', messageHonnete(neg, { ouvertPendant: -5000 }));

    await dormir(2500);
    assert.equal(courrierDe(sans), null,
      `un envoi SANS le champ de délai est parti (réponse ${r1.statut}) : un simple curl franchit la défense`);
    assert.equal(courrierDe(neg), null,
      `un envoi au délai impossible (-5000 ms) est parti (réponse ${r2.statut})`);
  });

  test("A5 — la réponse ne dit jamais à l'automate qu'il a été repéré", async () => {
    const laver = (t) => t
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<JETON>')
      .replace(/\d{4,}/g, '<N>');

    const honnete = await envoyer('POST', '/api/contact', messageHonnete(repere('A5ok')));
    const leurre = await envoyer('POST', '/api/contact', messageHonnete(repere('A5leurre'), { site: 'x' }));
    const vite = await envoyer('POST', '/api/contact', messageHonnete(repere('A5vite'), { ouvertPendant: 50 }));

    for (const [nom, r] of [['leurre', leurre], ['trop vite', vite]]) {
      assert.equal(r.statut, honnete.statut,
        `réponse ${r.statut} au cas « ${nom} » contre ${honnete.statut} au visiteur honnête : l'automate apprend qu'il est repéré`);
      assert.equal(laver(r.texte), laver(honnete.texte),
        `corps différent au cas « ${nom} » : ${r.texte} vs ${honnete.texte}`);
      assert.ok(!/robot|bot|spam|leurre|honeypot|piège|rejet|refus|trop vite|délai|suspect/i.test(r.texte),
        `la réponse au cas « ${nom} » nomme la défense : ${r.texte}`);
    }
  });

  test("A6 — le journal ne contient ni le message, ni l'adresse, ni le nom du visiteur", async () => {
    const rep = repere('A6');
    const avant = fs.existsSync(FICHIER_JOURNAL) ? fs.statSync(FICHIER_JOURNAL).size : 0;
    const corps = {
      nom: `Zéphirine NOM${rep}`,
      courriel: `adr${rep.toLowerCase()}@example.com`,
      message: `Ceci est confidentiel : MSG${rep} — mon numéro de compte et mes secrets.`,
      site: '', ouvertPendant: 9000, langue: 'fr',
    };
    const r = await envoyer('POST', '/api/contact', corps);
    assert.equal(r.silence, false, 'pas de réponse');
    await dormir(1200);

    const nouveau = fs.readFileSync(FICHIER_JOURNAL, 'utf8').slice(avant);
    /* Témoin du témoin : si le journal ne bouge pas, ce cas ne prouverait rien. */
    assert.notEqual(nouveau.trim(), '', 'le journal du banc ne bouge plus : ce cas ne prouverait rien (banc à revoir)');
    assert.ok(!nouveau.includes(`NOM${rep}`), 'le NOM du visiteur est écrit dans le journal');
    assert.ok(!nouveau.includes(`adr${rep.toLowerCase()}`), "l'ADRESSE du visiteur est écrite dans le journal");
    assert.ok(!nouveau.includes(`MSG${rep}`), 'le CONTENU du message est écrit dans le journal');
    assert.ok(!nouveau.includes('Zéphirine'), 'le prénom du visiteur est écrit dans le journal');
  });

  describe('A7 — ce que le service ne doit pas garder du visiteur', () => {
    const repSans = repere('A7sans');
    const repAvec = repere('A7avec');
    const ipDirecte = ipUnique();
    const relais = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;
    const navigateur = `Mozilla/5.0 (SondeEpreuve ${repSans})`;
    let journalSans = '';
    let journalAvec = '';

    before(async () => {
      /* Deux visites distinctes : l'une arrive en direct, l'autre passe par un
       * relais. Confondues dans un seul cas, la seconde masque la première. */
      let avant = fs.statSync(FICHIER_JOURNAL).size;
      await envoyer('POST', '/api/contact', messageHonnete(repSans), {
        ip: ipDirecte, entetes: { 'user-agent': navigateur },
      });
      await dormir(1000);
      journalSans = fs.readFileSync(FICHIER_JOURNAL, 'utf8').slice(avant);

      avant = fs.statSync(FICHIER_JOURNAL).size;
      await envoyer('POST', '/api/contact', messageHonnete(repAvec), {
        entetes: { 'x-forwarded-for': relais, 'user-agent': navigateur },
      });
      await dormir(1000);
      journalAvec = fs.readFileSync(FICHIER_JOURNAL, 'utf8').slice(avant);
    });

    test("A7a — l'adresse réseau du visiteur venu en direct n'est pas conservée", async () => {
      assert.notEqual(journalSans.trim(), '', 'le journal du banc ne bouge plus : ce cas ne prouverait rien');
      assert.ok(!journalSans.includes(ipDirecte),
        `l'adresse réseau du visiteur (${ipDirecte}) est écrite dans le journal`);
      const doc = await attendreArchive(repSans, 6000);
      if (doc) assert.ok(!JSON.stringify(doc).includes(ipDirecte), "l'adresse réseau est conservée dans l'archive");
    });

    test("A7b — l'adresse transmise par un relais n'est pas conservée non plus", async () => {
      assert.notEqual(journalAvec.trim(), '', 'le journal du banc ne bouge plus : ce cas ne prouverait rien');
      assert.ok(!journalAvec.includes(relais),
        `l'adresse du visiteur annoncée par le relais (${relais}) est écrite dans le journal`);
    });

    test("A7c — l'identifiant du navigateur n'est pas conservé", async () => {
      assert.ok(!journalSans.includes('SondeEpreuve') && !journalAvec.includes('SondeEpreuve'),
        "l'identifiant du navigateur du visiteur est écrit dans le journal");
      const doc = await attendreArchive(repSans, 6000);
      if (doc) assert.ok(!JSON.stringify(doc).includes('SondeEpreuve'), "l'identifiant du navigateur est conservé dans l'archive");
    });
  });

  test("A8 — aucun champ du formulaire n'ajoute de destinataire caché", async (t) => {
    const rep = repere('A8');
    const cache = `cache-${rep.toLowerCase()}@chalou.link`;  /* domaine relayé par le serveur : vraiment dangereux */
    const avant = Date.now();

    const r = await envoyer('POST', '/api/contact', {
      nom: `Pirate ${rep}\r\nBcc: ${cache}`,
      courriel: `visiteur.${rep.toLowerCase()}@example.com\r\nBcc: ${cache}`,
      message: `Bonjour ${rep}\r\nBcc: ${cache}\r\n.\r\nMAIL FROM:<pirate@chalou.link>\r\nRCPT TO:<${cache}>\r\nDATA\r\nmessage injecté\r\n.\r\n`,
      site: '', ouvertPendant: 9000, langue: 'fr',
    });
    assert.equal(r.silence, false, 'pas de réponse');
    await dormir(2500);

    const blocs = blocsCourrier(avant);
    /* Garde : si rien n'est parti, ce cas ne prouverait rien du tout. */
    if (r.statut >= 200 && r.statut < 300) {
      assert.ok(blocs.length >= 1,
        `le service a répondu ${r.statut} mais aucun courrier n'est parti : ce cas ne prouve rien (et le visiteur a été trompé)`);
    } else {
      t.diagnostic(`message d'injection refusé avant expédition (${r.statut}) — l'analyse d'enveloppe porte sur ${blocs.length} bloc(s)`);
    }
    for (const b of blocs) {
      const dest = b.destinataires;
      assert.ok(dest.includes(MAIL_TO), `enveloppe sans le destinataire prévu : « ${dest} »`);
      assert.ok(!dest.toLowerCase().includes('cache-'), `DESTINATAIRE CACHÉ dans l'enveloppe : « ${dest} »`);
      assert.equal(b.vers.length, 1, `plusieurs destinataires d'enveloppe : « ${dest} »`);

      const entetes = entetesDe(b);
      assert.ok(!/^b?cc\s*:/im.test(entetes), `en-tête Cc/Bcc ajouté au courrier :\n${entetes}`);
      const to = (entetes.match(/^To:(.*)$/mi) ?? [, ''])[1];
      assert.ok(!to.includes(','), `plusieurs destinataires dans l'en-tête To : « ${to} »`);
    }
    /* Nulle part, même dans une seconde transaction SMTP glissée par injection. */
    assert.ok(!blocs.some((b) => b.destinataires.toLowerCase().includes('cache-')), "un message a été expédié à un destinataire caché");
  });

  test("A8bis — destinataire caché SANS caractère de contrôle (ce qu'un filtre sur les retours à la ligne ne voit pas)", { timeout: 60000 }, async (t) => {
    const rep = repere('A8bis').toLowerCase();
    const complice = `complice-${rep}@chalou.link`;   /* domaine que le serveur relaie vraiment */
    const avant = Date.now();

    /* Trois formes voisines : la syntaxe d'adresse, la virgule, le saut de
     * ligne nu. Aucune n'a besoin d'un CRLF complet. */
    const essais = [
      ['guillemets dans le nom', { nom: `Amie" <${complice}>, "Reste` }],
      ['virgule dans l\'adresse', { courriel: `visiteur.${rep}@example.com, ${complice}` }],
      ['saut de ligne nu dans le nom', { nom: `Amie ${rep}\nBcc: ${complice}` }],
    ];
    const codes = [];
    for (const [quoi, modif] of essais) {
      const r = await envoyer('POST', '/api/contact', messageHonnete(`${rep}-${quoi.slice(0, 4)}`, modif), { timeoutMs: 20000 });
      codes.push(`${quoi}: ${r.statut}`);
    }
    await dormir(2500);
    t.diagnostic(codes.join(' | '));

    const blocs = blocsCourrier(avant);
    assert.ok(blocs.length >= 1,
      `aucune des trois formes n'a produit de courrier (${codes.join(' | ')}) : ce cas ne prouve rien sur l'expédition`);
    for (const b of blocs) {
      const dest = b.destinataires;
      assert.ok(!dest.includes('complice-'), `DESTINATAIRE CACHÉ dans l'enveloppe : « ${dest} »`);
      assert.equal(b.vers.length, 1, `plusieurs destinataires d'enveloppe : « ${dest} »`);
      const entetes = entetesDe(b);
      assert.ok(!/^b?cc\s*:/im.test(entetes), `en-tête Cc/Bcc ajouté :\n${entetes}`);
    }
  });

  describe("A9 — un visiteur insistant ne doit pas étouffer les autres", () => {
    const insistant = ipUnique();
    const repAutre = repere('A9autre');
    const statuts = [];
    const corps = [];
    let autre = null;
    let sante = null;

    before(async () => {
      for (let i = 0; i < 6; i++) {
        const r = await envoyer('POST', '/api/contact', messageHonnete(repere('A9rafale')), { ip: insistant });
        statuts.push(r.statut);
        corps.push(r.texte);
      }
      /* Aussitôt après, quelqu'un d'autre, d'une autre adresse. */
      autre = await envoyer('POST', '/api/contact', messageHonnete(repAutre), { ip: ipUnique() });
      sante = await envoyer('GET', '/api/sante');
    });

    test('A9a — le visiteur insistant finit par être freiné', () => {
      assert.ok(statuts.some((st) => st < 200 || st >= 300),
        `six envois d'affilée du même visiteur tous acceptés (${statuts.join(', ')}) : rien ne le freine`);
    });

    test("A9b — le freinage se dit comme un trop-plein, pas comme une panne du service", () => {
      const freines = statuts.map((st, i) => [st, corps[i]]).filter(([st]) => st < 200 || st >= 300);
      const serveur = freines.filter(([st]) => st >= 500);
      assert.equal(serveur.length, 0,
        `le freinage répond ${serveur.map(([st, c]) => st + ' ' + c).join(' | ')} : une erreur SERVEUR (5xx). ` +
        `Le visiteur honnête qui renvoie son message lit « le message n'a pas pu partir » au lieu de « attendez une minute », ` +
        `et une supervision qui compte les 5xx croira le service en panne.`);
      assert.ok(freines.every(([st]) => st === 429),
        `codes de freinage : ${freines.map(([st]) => st).join(', ')} — attendu 429 (trop de demandes)`);
    });

    test("A9c — pendant ce temps, un AUTRE visiteur passe et son message arrive", async () => {
      assert.equal(autre.silence, false, 'aucune réponse pour le second visiteur');
      assert.ok(autre.statut >= 200 && autre.statut < 300,
        `un visiteur insistant a fait refuser (${autre.statut} ${autre.texte}) le message d'un autre visiteur`);
      assert.notEqual(await attendreCourrier(repAutre, 8000), null,
        "le message du second visiteur n'est jamais arrivé dans la boîte");
      assert.equal(sante.statut, 200, 'le service ne répond plus après une rafale');
    });
  });

  test('A10 — un contenu démesuré est refusé, et le service y survit', { timeout: 90000 }, async () => {
    const repEnorme = repere('A10gros');
    const enorme = await envoyer('POST', '/api/contact',
      messageHonnete(repEnorme, { message: `${repEnorme} ` + 'A'.repeat(2_000_000) }), { timeoutMs: 40000 });
    assert.ok(enorme.statut === 0 || enorme.statut < 200 || enorme.statut >= 300,
      `un message de 2 Mo a été accepté (${enorme.statut})`);
    assert.equal(enorme.silence, false,
      `2 Mo : le service a coupé sans répondre (${enorme.erreur}) — le visiteur ne sait pas ce qui s'est passé`);

    const repLong = repere('A10moyen');
    const gros = await envoyer('POST', '/api/contact',
      messageHonnete(repLong, { message: `${repLong} ` + 'B'.repeat(300_000) }), { timeoutMs: 40000 });
    assert.ok(gros.statut < 200 || gros.statut >= 300, `un message de 300 000 signes a été accepté (${gros.statut})`);

    await dormir(2000);
    assert.equal(courrierDe(repEnorme), null, 'le message démesuré est parti quand même');
    assert.equal(await archiveDe(repEnorme), null, "le message démesuré a été archivé quand même");

    /* Témoin : après l'agression, le service sert encore les honnêtes gens. */
    const sante = await envoyer('GET', '/api/sante');
    assert.equal(sante.statut, 200, 'le service ne répond plus après un envoi démesuré');
    const repApres = repere('A10apres');
    const apres = await envoyer('POST', '/api/contact', messageHonnete(repApres));
    assert.ok(apres.statut >= 200 && apres.statut < 300, `service inutilisable après l'agression (${apres.statut})`);
    assert.notEqual(await attendreCourrier(repApres, 8000), null,
      "après un envoi démesuré, le service accepte mais ne délivre plus");
  });

  test("A12 — archive injoignable au démarrage : le service ne se tait pas là-dessus", { timeout: 120000 }, async (t) => {
    const svc = await lancerService('archive-morte-bruit', { MONGO_URL: mongoMort() });
    try {
      if (!svc.demarre) { t.diagnostic('le service ne démarre pas sans archive — voir T3'); return; }
      const rep = repere('A12');
      await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      await dormir(1500);
      assert.ok(/archive|mongo|copie|base/i.test(svc.sortie()),
        `le service tourne sans archive et n'en dit pas un mot : plus aucune copie n'est gardée, personne ne l'apprendra.\nJournal complet :\n${svc.sortie().slice(0, 800)}`);
    } finally { svc.arreter(); }
  });

  for (const [nom, modifs, defaut] of [
    ['sans destinataire', { MAIL_TO: null }, 'MAIL_TO absent'],
    ['destinataire vide', { MAIL_TO: '' }, 'MAIL_TO vide'],
    ['sans serveur de courrier', { SMTP_HOST: null }, 'SMTP_HOST absent'],
  ]) {
    test(`A11 (${defaut}) — ne pas démarrer en silence dans un état où les messages se perdent`, { timeout: 120000 }, async (t) => {
      const svc = await lancerService(`incomplet-${nom.replace(/\s+/g, '-')}`, modifs);
      try {
        if (!svc.demarre) {
          t.diagnostic(`branche : le service refuse de démarrer (code ${svc.codeSortie()})`);
          assert.notEqual(svc.sortie().trim(), '',
            `${defaut} : le service s'est arrêté SANS rien dire (code ${svc.codeSortie()}) — personne ne saura pourquoi`);
          assert.ok(/manqu|absent|oblig|erreur|invalid|MAIL_TO|SMTP|réglage|reglage|configuration/i.test(svc.sortie()),
            `${defaut} : le service s'arrête mais n'explique rien d'utilisable :\n${svc.sortie().slice(0, 600)}`);
          return;
        }
        t.diagnostic('branche : le service a DÉMARRÉ malgré le réglage manquant');
        const rep = repere('A11');
        const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 40000 });
        assert.equal(r.silence, false, `${defaut} : aucune réponse`);
        assert.ok(r.statut < 200 || r.statut >= 300,
          `${defaut} : le service a démarré sans broncher et répond « ${r.texte} » (${r.statut}) — les messages se perdent en silence`);
      } finally { svc.arreter(); }
    });
  }
});

/* ═══════════════════════════════════════════════════════════════════
 *   II. TÉMOINS — ce qui doit CONTINUER de fonctionner
 * ═══════════════════════════════════════════════════════════════════ */

describe('TÉMOINS', () => {

  test('T0 — le service est vivant et le dit', async () => {
    const r = await envoyer('GET', '/api/sante');
    assert.equal(r.statut, 200, `/api/sante répond ${r.statut} ${r.erreur ?? ''}`);
  });

  describe('T1/T2 — un message honnête arrive vraiment', () => {
    const rep = repere('T1');
    let reponse = null;
    before(async () => { reponse = await envoyer('POST', '/api/contact', messageHonnete(rep)); });

    test("T1 — il est ACCEPTÉ, et il ARRIVE dans la boîte du destinataire, intact", async () => {
      assert.equal(reponse.silence, false, `pas de réponse : ${reponse.erreur}`);
      assert.ok(reponse.statut >= 200 && reponse.statut < 300,
        `un visiteur honnête est refusé (${reponse.statut} ${reponse.texte})`);
      const bloc = await attendreCourrier(rep, 10000);
      assert.notEqual(bloc, null, "le message est accepté mais n'arrive jamais dans la boîte");
      assert.ok(bloc.vers.some((v) => v.includes(MAIL_TO)), `le courrier ne va pas à ${MAIL_TO} : enveloppe « ${bloc.destinataires} »`);
      assert.ok(bloc.decode.includes('Où êtes-vous ? œuf, ça va'), 'les accents du message sont abîmés en route');
      assert.ok(bloc.decode.includes(`camille.durand+${rep.toLowerCase()}@example.com`),
        "l'adresse du visiteur n'apparaît pas dans le courrier : impossible de lui répondre");
    });

    test("T1bis — il est parti CHIFFRÉ (après STARTTLS), avec authentification", async () => {
      /* Le faux courrier note si le message est arrivé après l'élévation TLS.
       * Un service qui enverrait en clair sur le 587 passerait T1 et
       * finirait chez le vrai serveur… dans les indésirables ou refusé. */
      const bloc = await attendreCourrier(rep, 10000);
      assert.notEqual(bloc, null, 'aucun courrier à examiner');
      assert.equal(bloc.chiffre, true, 'le courrier du formulaire est parti EN CLAIR : le service n\'a pas demandé STARTTLS');
    });

    test("T2 — il est retrouvable dans la copie conservée, intact", async () => {
      const doc = await attendreArchive(rep, 10000);
      assert.notEqual(doc, null, "le message n'est pas dans l'archive");
      const texte = JSON.stringify(doc);
      assert.ok(texte.includes(`${rep}-NOM`), "le nom du visiteur manque dans la copie");
      assert.ok(texte.includes(`camille.durand+${rep.toLowerCase()}@example.com`), "l'adresse du visiteur manque dans la copie");
      assert.ok(doc.message?.includes('œuf'), 'le texte du message est absent ou abîmé dans la copie');
    });
  });

  test('T3 — copie impossible : le courrier part quand même', { timeout: 150000 }, async () => {
    const svc = await lancerService('sans-archive', { MONGO_URL: mongoMort() });
    try {
      assert.ok(svc.demarre,
        `archive injoignable : le service refuse de servir (code ${svc.codeSortie()}) — tous les messages sont perdus alors que le courrier pouvait partir\n${svc.sortie().slice(0, 400)}`);
      const rep = repere('T3');
      const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      assert.equal(r.silence, false, 'pas de réponse');
      assert.notEqual(await attendreCourrier(rep, 12000), null,
        "archive injoignable : le courrier n'est pas parti non plus");
      assert.ok(r.statut >= 200 && r.statut < 300,
        `le courrier est bien parti mais le visiteur reçoit ${r.statut} : il va renvoyer, et Charles recevra deux fois`);
    } finally { svc.arreter(); }
  });

  test('T4 — courrier impossible : la copie est faite quand même', { timeout: 150000 }, async () => {
    /* Courrier injoignable : le 587 de CE service mène à un port mort. */
    const svc = await lancerService('sans-courrier', {}, { portCourrier: PORT_MORT_SMTP });
    try {
      assert.ok(svc.demarre,
        `courrier injoignable : le service refuse de servir (code ${svc.codeSortie()}) — aucune copie n'est prise\n${svc.sortie().slice(0, 400)}`);
      const rep = repere('T4');
      const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      assert.equal(r.silence, false, 'pas de réponse');
      assert.notEqual(await attendreArchive(rep, 12000), null,
        "courrier injoignable : le message n'a pas été copié non plus, il est définitivement perdu");
      assert.equal(courrierDe(rep), null, 'le banc est faux : un courrier est arrivé alors que le 587 menait à un port mort');
    } finally { svc.arreter(); }
  });

  test("T8 — courrier refusé par le serveur : la copie est faite quand même", { timeout: 150000 }, async (t) => {
    const svc = await lancerService('refus-destinataire-archive-ok', { MAIL_TO: 'quelquun@ailleurs-non-relaye.example' });
    try {
      assert.ok(svc.demarre, `le service ne démarre pas (code ${svc.codeSortie()}) : ${svc.sortie().slice(0, 300)}`);
      const rep = repere('T8');
      const r = await envoyer('POST', '/api/contact', messageHonnete(rep), { port: svc.port, timeoutMs: 60000 });
      assert.equal(r.silence, false, 'pas de réponse');
      t.diagnostic(`réponse au visiteur : ${r.statut} ${r.texte}`);
      assert.notEqual(await attendreArchive(rep, 12000), null,
        "le serveur de courrier a refusé le destinataire ET aucune copie n'a été gardée : le message est perdu sans trace");
      const sante = await envoyer('GET', '/api/sante', undefined, { port: svc.port });
      assert.equal(sante.statut, 200, 'le service est tombé sur un refus du serveur de courrier');
    } finally { svc.arreter(); }
  });

  test('T5 — le visiteur qui se trompe reçoit une réponse qui le lui dit', async () => {
    const cas = [
      ['adresse mal écrite', messageHonnete(repere('T5adr'), { courriel: 'camille arobase example' })],
      ['message oublié', messageHonnete(repere('T5msg'), { message: '   ' })],
      ['nom oublié', messageHonnete(repere('T5nom'), { nom: '' })],
      ['formulaire vide', {}],
      ['envoi abîmé en route', '{"nom":"Camille", ceci n\'est pas du JSON'],
    ];
    for (const [quoi, corps] of cas) {
      const r = await envoyer('POST', '/api/contact', corps, { timeoutMs: 15000 });
      assert.equal(r.silence, false, `« ${quoi} » : aucune réponse, le visiteur reste devant un écran figé`);
      assert.ok(r.statut >= 400 && r.statut < 500,
        `« ${quoi} » : réponse ${r.statut} — le visiteur ne sait pas que c'est SA saisie qu'il faut corriger`);
      assert.notEqual(r.texte.trim(), '', `« ${quoi} » : réponse vide`);
    }
  });

  test('T6 — un long message légitime passe et arrive', { timeout: 60000 }, async () => {
    const rep = repere('T6');
    const texte = `${rep} ` + 'Je vous écris longuement, car le sujet le mérite. '.repeat(80);
    const r = await envoyer('POST', '/api/contact', messageHonnete(rep, { message: texte }), { timeoutMs: 30000 });
    assert.ok(r.statut >= 200 && r.statut < 300,
      `un message légitime de ${texte.length} signes est refusé (${r.statut} ${r.texte}) : la limite étouffe les vrais visiteurs`);
    assert.notEqual(await attendreCourrier(rep, 12000), null, "le long message n'est jamais arrivé");
  });

  test("T7 — un second message du même visiteur, à quelques secondes, n'est pas confondu avec un robot", async () => {
    const ip = ipUnique();
    const un = repere('T7a');
    const deux = repere('T7b');
    const r1 = await envoyer('POST', '/api/contact', messageHonnete(un), { ip });
    await dormir(1500);
    const r2 = await envoyer('POST', '/api/contact', messageHonnete(deux), { ip });
    assert.ok(r1.statut >= 200 && r1.statut < 300, `premier message refusé (${r1.statut})`);
    assert.ok(r2.statut >= 200 && r2.statut < 300,
      `le second message du même visiteur honnête est refusé (${r2.statut}) : un oubli de pièce jointe et il est bloqué`);
    assert.notEqual(await attendreCourrier(deux, 10000), null, "le second message du visiteur n'est jamais arrivé");
  });
});
