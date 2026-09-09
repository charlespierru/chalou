/* Le webhook GitHub qui met FadeBeat à jour — chantier 94.b.
 *
 * GitHub frappe ici à chaque push sur le dépôt public de FadeBeat. Quatre
 * règles gouvernent ce fichier :
 *
 *  1. Le webhook n'est qu'un SIGNAL. On vérifie sa signature sur le corps
 *     brut, on lit trois champs (événement, branche, dépôt), et on ne fait
 *     confiance à rien d'autre : le fichier est relu sur GitHub, au sommet
 *     RÉEL de master tel que l'API le rend — jamais au commit annoncé par le
 *     corps, parce qu'une relivraison ancienne remettrait une vieille version
 *     en ligne, journal au vert (réfutation du plan, point B4a).
 *  2. Refuser plutôt que servir n'importe quoi : le fichier reçu doit être un
 *     document HTML, d'une taille raisonnable, et porter EXACTEMENT UNE fois
 *     la ligne du CDN Tailwind qu'on remplace par la copie locale. Sinon
 *     l'ancien reste en ligne, GitHub reçoit une erreur, Charles un courriel.
 *  3. Répondre à GitHub d'abord, alerter ensuite : GitHub coupe à 10 s, et le
 *     courrier peut mettre plus. La page « Recent Deliveries » du dépôt doit
 *     montrer le vrai résultat. Tout le travail tient dans un BUDGET global
 *     (audit du 2026-09-09, I-1 : les délais empilés faisaient 12,5 s).
 *  4. UNE mise à jour à la fois, et le sommet est relu juste avant d'écrire :
 *     deux livraisons rapprochées faisaient écraser la version neuve par
 *     l'ancienne, avec deux 200 et zéro alerte (audit du 2026-09-09, B-2).
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { envoyerAlerte } from '../mail.js';

const DEPOT = 'charlespierru/FadeBeat';
const BRANCHE = 'refs/heads/master';
const FICHIER = 'FadeBeat.html';
const LIGNE_CDN = '<script src="https://cdn.tailwindcss.com"></script>';
const LIGNE_LOCALE = '<script src="tailwind.js"></script>';
const TAILLE_MIN = 10 * 1024;
const TAILLE_MAX = 2 * 1024 * 1024;
const PREFIXE_TEMPORAIRE = '.index.html.tmp-';

/* Le budget : GitHub coupe à 10 s ; on répond avant. L'API a 3 s ; le brut
 * a le reste, en trois tentatives au plus (un sha tout frais peut répondre
 * 404 quelques secondes, réfutation B4b), chacune bornée par ce qui reste. */
const BUDGET_MS = 8500;
const DELAI_API_MS = 3000;
const DELAI_BRUT_MAX_MS = 2500;
const TENTATIVES = 3;
const ATTENTE_ENTRE_TENTATIVES_MS = 800;

class Refus extends Error {
  constructor(message, statut = 502) {
    super(message);
    this.statut = statut;
  }
}

/* ── La signature ─────────────────────────────────────────────────────── */
function signatureValide(corpsBrut, entete, secret) {
  if (typeof entete !== 'string' || !entete.startsWith('sha256=')) return false;
  const attendue = Buffer.from(
    createHmac('sha256', secret).update(corpsBrut).digest('hex'), 'utf8');
  const recue = Buffer.from(entete.slice('sha256='.length), 'utf8');
  /* timingSafeEqual LANCE si les longueurs diffèrent : une signature de
   * mauvaise longueur doit donner 401, jamais 500. */
  if (recue.length !== attendue.length) return false;
  return timingSafeEqual(recue, attendue);
}

/* ── GitHub ───────────────────────────────────────────────────────────── */
class Budget {
  constructor(ms) { this.fin = Date.now() + ms; }
  reste() { return this.fin - Date.now(); }
}

async function chercher(url, delaiMs, accept) {
  try {
    return await fetch(url, {
      headers: { accept, 'user-agent': 'chalou.link-webhook-fadebeat' },
      signal: AbortSignal.timeout(Math.max(1, delaiMs)),
    });
  } catch (e) {
    /* Une coupure ou un délai dépassé est une panne d'amont : 502, comme
     * toute autre réponse de GitHub qui ne va pas. */
    throw new Refus(`GitHub injoignable sur ${url} : ${e.name === 'TimeoutError' ? 'délai dépassé' : e.message}`);
  }
}

async function sommetDeMaster(budget) {
  const url = `${config.githubApiBase}/repos/${DEPOT}/branches/master`;
  const reponse = await chercher(url, Math.min(DELAI_API_MS, budget.reste()), 'application/vnd.github+json');
  if (!reponse.ok) throw new Refus(`GitHub a répondu ${reponse.status} sur ${url}`);
  let corps;
  try { corps = await reponse.json(); } catch { throw new Refus("l'API GitHub n'a pas rendu du JSON"); }
  const sha = corps?.commit?.sha;
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Refus("l'API GitHub n'a pas rendu un sha de commit bien formé");
  }
  return sha;
}

async function telechargerFadeBeat(sha, budget) {
  const url = `${config.githubRawBase}/${DEPOT}/${sha}/${FICHIER}`;
  let derniere = null;
  for (let essai = 1; essai <= TENTATIVES; essai++) {
    const reste = budget.reste();
    if (reste < 500) break;
    try {
      const reponse = await chercher(url, Math.min(DELAI_BRUT_MAX_MS, reste), 'text/plain');
      if (reponse.ok) return await reponse.text();
      derniere = new Refus(`GitHub a répondu ${reponse.status} pour ${FICHIER} au commit ${sha}`);
    } catch (e) {
      derniere = e;
    }
    if (essai < TENTATIVES && budget.reste() > ATTENTE_ENTRE_TENTATIVES_MS + 500) {
      await new Promise((r) => setTimeout(r, ATTENTE_ENTRE_TENTATIVES_MS));
    }
  }
  throw derniere ?? new Refus('budget de temps épuisé avant de joindre GitHub');
}

/* ── Le fichier ───────────────────────────────────────────────────────── */
function transformer(texte, sha) {
  const taille = Buffer.byteLength(texte, 'utf8');
  if (taille < TAILLE_MIN) throw new Refus(`fichier trop petit (${taille} octets)`);
  if (taille > TAILLE_MAX) throw new Refus(`fichier trop gros (${taille} octets)`);
  if (!/^\s*<!doctype html/i.test(texte)) throw new Refus("ce n'est pas un document HTML");

  const occurrences = texte.split(LIGNE_CDN).length - 1;
  if (occurrences !== 1) {
    throw new Refus(`la ligne du CDN Tailwind apparaît ${occurrences} fois, une seule attendue — FadeBeat a changé de forme, il faut regarder`);
  }
  /* La marque ne porte que le sha : une relivraison réécrit alors des octets
   * identiques (audit, M-3). La date est dans le journal. */
  const marque = `<!-- FadeBeat ${sha} — servi par chalou.link, mis à jour par webhook -->`;
  return texte
    .replace(LIGNE_CDN, LIGNE_LOCALE)
    .replace(/^(\s*<!doctype html[^>]*>)/i, `$1\n${marque}`);
}

async function ecrireDunCoup(contenu) {
  const cible = path.join(config.fadebeatDossier, 'index.html');
  const temporaire = path.join(config.fadebeatDossier,
    `${PREFIXE_TEMPORAIRE}${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    await fs.writeFile(temporaire, contenu, { encoding: 'utf8', mode: 0o644 });
    await fs.rename(temporaire, cible);
  } catch (e) {
    await fs.rm(temporaire, { force: true }).catch(() => {});
    throw new Refus(`écriture impossible dans ${config.fadebeatDossier} : ${e.message}`, 500);
  }
  return cible;
}

/* Un temporaire abandonné (service tué entre l'écriture et le renommage) est
 * balayé au démarrage : il appartiendrait à `chalou` dans un dossier servi
 * (audit, M-1). */
async function balayerLesTemporaires(log) {
  try {
    for (const nom of await fs.readdir(config.fadebeatDossier)) {
      if (nom.startsWith(PREFIXE_TEMPORAIRE)) {
        await fs.rm(path.join(config.fadebeatDossier, nom), { force: true });
        log.warn({ fichier: nom }, 'temporaire abandonné balayé');
      }
    }
  } catch (e) {
    log.warn({ cause: e.message }, 'le dossier FadeBeat ne se laisse pas lire au démarrage');
  }
}

/* ── La route ─────────────────────────────────────────────────────────── */
export default async function routeGithub(app) {
  await balayerLesTemporaires(app.log);

  /* Le corps est gardé BRUT : la signature se calcule sur les octets reçus,
   * pas sur un JSON reparsé. Ce parseur ne vaut que dans ce plugin — le
   * formulaire de contact garde le sien. */
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1024 * 1024 },
    (requete, corps, fait) => fait(null, corps));

  /* Une mise à jour à la fois. Chaque livraison attend la précédente, puis
   * relit le sommet : la dernière livraison déploie toujours le dernier
   * sommet, quel que soit l'ordre d'arrivée ou la lenteur du brut. */
  let file = Promise.resolve();
  const auTour = (travail) => {
    const mien = file.then(travail, travail);
    file = mien.catch(() => {});
    return mien;
  };

  const alerter = (sujet, texte, log) => envoyerAlerte({ sujet, texte, log });

  app.post('/api/github/fadebeat', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    bodyLimit: 1024 * 1024,
  }, async (requete, reponse) => {
    const livraison = String(requete.headers['x-github-delivery'] ?? '').slice(0, 80);
    const evenement = String(requete.headers['x-github-event'] ?? '').slice(0, 40);
    const corpsBrut = Buffer.isBuffer(requete.body) ? requete.body : Buffer.alloc(0);

    if (!signatureValide(corpsBrut, requete.headers['x-hub-signature-256'], config.githubWebhookSecret)) {
      requete.log.warn({ livraison, evenement }, 'webhook refusé : signature absente ou fausse');
      return reponse.code(401).send({ erreur: 'signature-invalide' });
    }

    if (evenement === 'ping') {
      requete.log.info({ livraison }, 'webhook : ping');
      return reponse.code(200).send({ pong: true });
    }
    if (evenement !== 'push') {
      requete.log.info({ livraison, evenement }, 'webhook ignoré : pas un push');
      return reponse.code(204).send();
    }

    let corps;
    try {
      corps = JSON.parse(corpsBrut.toString('utf8'));
    } catch {
      return reponse.code(400).send({ erreur: 'corps-illisible' });
    }
    const depot = corps?.repository?.full_name;
    const ref = corps?.ref;
    if (depot !== DEPOT || ref !== BRANCHE) {
      requete.log.info({ livraison, depot, ref }, 'webhook ignoré : autre dépôt ou autre branche');
      await reponse.code(204).send();
      /* Un renommage figerait le site en silence (audit, I-2) : on alerte si
       * le dépôt n'a plus le bon nom, ou si sa branche PAR DÉFAUT n'est plus
       * master. Un push sur une branche de travail, ou un tag, ne dit rien. */
      const defaut = corps?.repository?.default_branch;
      if (depot !== DEPOT || (typeof defaut === 'string' && defaut !== 'master')) {
        await alerter('webhook FadeBeat reçu pour un autre dépôt ou une autre branche',
          `Un push authentique a été reçu (livraison ${livraison || 'inconnue'}) mais ignoré :\n` +
          `dépôt ${depot ?? 'inconnu'}, référence ${ref ?? 'inconnue'}, branche par défaut ${defaut ?? 'inconnue'}.\n` +
          `Attendu : ${DEPOT}, ${BRANCHE}. Si master ou le dépôt ont été renommés, le site ne se mettra plus à jour tant que la route n'est pas ajustée.\n`,
          requete.log);
      }
      return reponse;
    }

    /* Le déploiement, à son tour. Le sha du corps (`after`) n'est que
     * journalisé. Le budget démarre à la SORTIE de la file : une livraison qui
     * a attendu derrière une lente ne doit pas arriver sans temps (re-audit
     * du 2026-09-09). GitHub, lui, compte depuis l'envoi ; la file est courte
     * (une mise à jour dure moins d'une seconde en pratique). */
    let budget = null;
    let sha = null;
    try {
      const resultat = await auTour(async () => {
        budget = new Budget(BUDGET_MS);
        sha = await sommetDeMaster(budget);
        const texte = await telechargerFadeBeat(sha, budget);
        const contenu = transformer(texte, sha);
        /* Le sommet a-t-il bougé pendant le téléchargement ? Alors ce fichier
         * est déjà périmé : on ne l'écrit pas, la livraison du nouveau push
         * (déjà dans la file, ou à venir) déploiera le bon. */
        const sommetMaintenant = await sommetDeMaster(budget);
        if (sommetMaintenant !== sha) {
          return { depasse: sommetMaintenant };
        }
        const cible = await ecrireDunCoup(contenu);
        return { cible, octets: Buffer.byteLength(contenu, 'utf8') };
      });
      if (resultat.depasse) {
        requete.log.info({ livraison, sha, sommet: resultat.depasse }, 'FadeBeat : sommet dépassé pendant le téléchargement, rien écrit, la livraison suivante déploiera');
        return reponse.code(200).send({ deploye: null, depasse: resultat.depasse });
      }
      requete.log.info(
        { livraison, sha, annonce: String(corps?.after ?? '').slice(0, 40), cible: resultat.cible, octets: resultat.octets },
        'FadeBeat mise à jour'
      );
      return reponse.code(200).send({ deploye: sha });
    } catch (e) {
      const statut = e instanceof Refus ? e.statut : 500;
      requete.log.error({ livraison, sha, cause: e.message }, "FadeBeat n'a PAS été mise à jour");
      /* Répondre d'abord, alerter ensuite : GitHub coupe à 10 s. */
      await reponse.code(statut).send({ erreur: 'mise-a-jour-ratee', cause: e.message });
      await alerter('FadeBeat n’a pas été mise à jour',
        `Le webhook GitHub a été reçu (livraison ${livraison || 'inconnue'}), mais la mise à jour a raté.\n` +
        `Cause : ${e.message}\n` +
        `Sommet de master vu : ${sha ?? 'non lu'}\n` +
        `L'ancienne version de FadeBeat reste en ligne. Voir aussi la page « Recent Deliveries » du dépôt.\n`,
        requete.log);
      return reponse;
    }
  });
}
