/* Réglages du service, lus une fois au démarrage puis gelés.
 *
 * Principe : le service REFUSE de démarrer plutôt que de tourner à moitié.
 * Un service qui démarre avec un réglage manquant fait croire que tout va
 * bien pendant que les messages se perdent — c'est la panne silencieuse,
 * la pire de toutes.
 */

import { readFileSync } from 'node:fs';

const refus = (raison) => {
  console.error('\nDémarrage refusé : ' + raison + '\n');
  process.exit(1);
};

/* Le secret du webhook n'est PAS dans le fichier de réglages : il est dans
 * un fichier à part, posé par le guichet, lisible du seul service. On n'en
 * lit que la première ligne, comme le coffre. Absent ou vide : refus, car une
 * route de webhook sans secret accepterait n'importe qui. */
const lireSecretDansFichier = (chemin) => {
  let contenu;
  try {
    contenu = readFileSync(chemin, 'utf8');
  } catch (e) {
    refus(`le fichier du secret du webhook est illisible (${chemin}) : ${e.message}`);
  }
  const premiere = contenu.split('\n')[0].trim();
  if (premiere.length < 16) {
    refus(`le fichier du secret du webhook (${chemin}) est vide ou trop court.`);
  }
  return premiere;
};

const lire = (nom, defaut = undefined) => {
  const v = process.env[nom];
  if (v === undefined || v === '') {
    if (defaut === undefined) refus(`le réglage ${nom} est absent.`);
    return defaut;
  }
  return v;
};

/* ── LA RÈGLE DE LA MAISON POUR ENVOYER DU COURRIER ──
 *
 * Elle est écrite dans la documentation de Charles
 * (docs/email/webmail-ajouter-une-boite.md), et elle ne souffre aucune
 * exception :
 *
 *     Envoi : mx.tonik.ink, port 587 — TOUJOURS, quel que soit le domaine,
 *     avec élévation TLS et authentification.
 *
 * Deux raisons, et la seconde a coûté une soirée le 2026-09-07 :
 *
 *  1. Le serveur de courrier ne présente qu'UN seul certificat sur ce port.
 *     Lui parler sous un autre nom — ou pire, par une adresse numérique —
 *     fait échouer la vérification, et le message ne part pas.
 *
 *  2. Surtout : un envoi authentifié sur le port 587 est une SOUMISSION.
 *     Le serveur le traite comme du courrier de la maison. Un envoi non
 *     authentifié sur le port 25 est du courrier VENU DU DEHORS : il subit
 *     le filtre anti-indésirables, qui le met de côté parce que le domaine
 *     déclare publiquement n'autoriser qu'un autre expéditeur.
 *     Résultat vécu : les messages partaient, arrivaient — et finissaient
 *     tous dans les indésirables, sans que personne le sache.
 *
 * Les trois refus ci-dessous existent pour qu'on ne refasse jamais ce
 * chemin-là par économie de secret.
 */
for (const requis of ['SMTP_USER', 'SMTP_PASS']) {
  if (!process.env[requis]) {
    refus(
      `le réglage ${requis} est absent, or le courrier doit partir en envoi\n` +
      "  AUTHENTIFIÉ sur le port 587. Sans authentification, le message est\n" +
      '  traité comme venu du dehors et finit dans les indésirables.\n' +
      '  Voir le commentaire en tête de server/src/config.js.'
    );
  }
}
if (/^\d{1,3}(\.\d{1,3}){3}$/.test(process.env.SMTP_HOST ?? '')) {
  refus(
    `le serveur de courrier est désigné par une adresse numérique\n` +
    `  (${process.env.SMTP_HOST}), or son certificat porte un nom : la\n` +
    "  vérification échouerait. Écrire « mx.tonik.ink », toujours."
  );
}
if (process.env.SMTP_PORT && process.env.SMTP_PORT !== '587') {
  refus(
    `le port d'envoi est ${process.env.SMTP_PORT}, or la règle de la maison\n` +
    '  est le port 587 — le seul qui soit une soumission authentifiée.\n' +
    '  Le port 25 fait entrer le message par la porte du courrier du dehors,\n' +
    '  celle qui est filtrée.'
  );
}

export const config = Object.freeze({
  env: lire('NODE_ENV', 'development'),
  /* 3002, déclaré explicitement dans la politique de sécurité du serveur, à
   * côté du 3001 de l'autre application — c'est la convention de la maison :
   * on choisit son port et on le déclare, plutôt que de se glisser dans un
   * numéro que la distribution autorise par défaut.
   *
   * Sans cette déclaration, nginx n'a PAS le droit de joindre ce port : la
   * page renverrait une erreur 502 sans un mot dans le journal de nginx.
   * La commande figure dans deploy/premiere-installation.md.
   *
   * Le service n'écoute que sur la machine elle-même ; le pare-feu ne laisse
   * entrer que SSH, le web et le web sécurisé (mesuré le 2026-09-07). */
  port: Number(lire('PORT', '3002')),

  /* La base d'archive. Propre à ce site, avec son propre compte. */
  mongoUrl: lire('MONGO_URL'),
  mongoDb: lire('MONGO_DB', 'chalou'),

  /* Le courrier : où l'on poste, avec quelle identité, et à qui il arrive. */
  smtpHost: lire('SMTP_HOST'),
  smtpPort: Number(lire('SMTP_PORT', '587')),
  smtpUser: lire('SMTP_USER'),
  smtpPass: lire('SMTP_PASS'),
  mailFrom: lire('MAIL_FROM'),
  mailTo: lire('MAIL_TO'),

  /* Anti-robot : un message écrit en moins de ce délai n'a pas été écrit. */
  delaiMinimalMs: Number(lire('DELAI_MINIMAL_MS', '3000')),

  /* Combien de temps on garde les messages, en mois. Annoncé sur /mentions. */
  conservationMois: Number(lire('CONSERVATION_MOIS', '24')),

  /* ── Le webhook GitHub qui met FadeBeat à jour (chantier 94.b) ── */
  githubWebhookSecret: lireSecretDansFichier(lire('GITHUB_WEBHOOK_SECRET_FILE')),
  fadebeatDossier: lire('FADEBEAT_DOSSIER'),
  /* Les deux adresses de GitHub sont des réglages pour une seule raison : le
   * banc d'essai doit pouvoir jouer un faux GitHub en local. */
  githubApiBase: lire('GITHUB_API_BASE', 'https://api.github.com'),
  githubRawBase: lire('GITHUB_RAW_BASE', 'https://raw.githubusercontent.com'),
});
