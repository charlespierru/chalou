/* Le service du site chalou.link.
 *
 * Il ne sert AUCUNE page : c'est nginx qui sert les fichiers de public/.
 * Ce service n'existe que pour le formulaire de contact. Conséquence voulue :
 * s'il tombe, le site reste debout et seul l'envoi d'un message est en panne.
 *
 * Il n'écoute que sur la machine elle-même, jamais sur l'extérieur.
 */

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { connecter, fermer as fermerBase } from './db.js';
import { fermer as fermerMail } from './mail.js';
import routeContact from './routes/contact.js';
import routeGithub from './routes/github.js';

const app = Fastify({
  logger: {
    level: config.env === 'production' ? 'info' : 'debug',

    /* L'ADRESSE DU VISITEUR NE DOIT PAS ARRIVER JUSQU'AU JOURNAL.
     *
     * Par défaut, Fastify écrit l'adresse de chaque requête dans son journal,
     * et derrière nginx ce serait l'adresse publique réelle du visiteur.
     * Or la page « Mentions » de ce site promet de ne pas la conserver.
     * On remplace donc la description des requêtes par le strict nécessaire.
     *
     * Défaut trouvé par une épreuve indépendante le 2026-09-07 : le journal
     * gardait l'adresse à chaque message reçu. Le site mentait.
     */
    serializers: {
      req: (requete) => ({ method: requete.method, url: requete.url }),
    },

    /* Et le contenu du message n'y va pas non plus : il est dans la boîte et
     * dans l'archive, pas dans un fichier de journal. */
    redact: {
      paths: ['req.body.message', 'req.body.courriel', 'req.body.nom'],
      censor: '[retiré]',
    },
  },
  /* Sans ceci, toutes les requêtes semblent venir de nginx : la limite de
   * débit bloquerait alors tous les visiteurs d'un coup, dès qu'un seul
   * insiste. UN SEUL saut de confiance, pas « tous » : avec `true`, Fastify
   * croyait la valeur la plus à gauche de X-Forwarded-For, que le client
   * choisit lui-même — n'importe qui pouvait se faire passer pour GitHub et
   * bloquer les vraies livraisons, ou contourner le freinage (audit du
   * 2026-09-09, B-1, prouvé en production). On nomme donc LE relais de
   * confiance, nginx sur cette machine : seule l'adresse qu'il ajoute compte.
   * Pas un nombre de sauts : dans Fastify 5.12, un compte de sauts « ne peut
   * pas valider le pair immédiat » et se ferme — tout le monde devenait
   * 127.0.0.1, un seul compteur pour la planète (re-audit du 2026-09-09,
   * prouvé en production depuis deux adresses). */
  trustProxy: '127.0.0.1',
  bodyLimit: 64 * 1024,
});

await app.register(rateLimit, {
  global: true,
  max: 60,
  timeWindow: '1 minute',
  /* Le « statusCode » est indispensable : sans lui, un visiteur freiné reçoit
   * une erreur 500, c'est-à-dire « le serveur est en panne ». Il lirait alors
   * le mauvais message, et toute surveillance croirait à une panne réelle à
   * chaque robot qui insiste. 429 veut dire « trop vite, réessayez ».
   * Défaut trouvé par une épreuve indépendante le 2026-09-07. */
  errorResponseBuilder: (requete, contexte) => ({
    statusCode: 429,
    erreur: 'trop-de-demandes',
    reessayerDansSecondes: Math.ceil((contexte.ttl ?? 60000) / 1000),
  }),
});

await app.register(routeContact);
await app.register(routeGithub);

/* L'archive est un confort, pas une condition : si elle manque au démarrage,
 * le service tourne quand même et les messages partent par courrier. */
try {
  await connecter(app.log);
} catch (e) {
  app.log.error({ cause: e.message }, "archive injoignable — le service démarre sans elle");
}

const arret = async (signal) => {
  app.log.info({ signal }, 'arrêt demandé');
  await app.close();
  await fermerMail();
  await fermerBase();
  process.exit(0);
};
process.on('SIGINT', () => arret('SIGINT'));
process.on('SIGTERM', () => arret('SIGTERM'));

await app.listen({ port: config.port, host: '127.0.0.1' });
