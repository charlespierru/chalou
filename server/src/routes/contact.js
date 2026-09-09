/* La route du formulaire de contact.
 *
 * Deux règles gouvernent tout ce fichier :
 *
 *  1. Le courrier et l'archive sont INDÉPENDANTS. Si l'un des deux tombe,
 *     l'autre passe quand même, et le journal dit lequel a manqué. Un visiteur
 *     ne doit jamais voir « erreur » parce qu'un tunnel entre deux machines a
 *     hoqueté.
 *  2. Un robot repéré reçoit exactement la même réponse qu'un visiteur
 *     honnête. Lui dire qu'il est repéré, c'est lui apprendre à mieux se
 *     cacher.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { archiver } from '../db.js';
import { envoyer } from '../mail.js';

const LIMITES = { nom: 120, courriel: 200, message: 5000 };
const ADRESSE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const propre = (v, max) => String(v ?? '').replace(/\0/g, '').trim().slice(0, max);

export default async function routeContact(app) {
  app.post('/api/contact', {
    config: {
      /* Bien plus sévère que la limite générale : personne n'écrit trois vrais
       * messages en une minute. */
      rateLimit: { max: 3, timeWindow: '1 minute' },
    },
    schema: {
      body: {
        type: 'object',
        required: ['nom', 'courriel', 'message'],
        properties: {
          nom: { type: 'string' },
          courriel: { type: 'string' },
          message: { type: 'string' },
          site: { type: 'string' },            // le champ leurre
          ouvertPendant: { type: 'number' },   // le délai de remplissage
          langue: { type: 'string' },
        },
      },
    },
  }, async (requete, reponse) => {

    const nom = propre(requete.body.nom, LIMITES.nom);
    const courriel = propre(requete.body.courriel, LIMITES.courriel);
    const message = propre(requete.body.message, LIMITES.message);
    const langue = requete.body.langue === 'en' ? 'en' : 'fr';

    /* ── Le champ leurre ──
     * Invisible à l'écran, hors d'atteinte au clavier. Un humain ne peut pas
     * le remplir ; un robot qui remplit tout ce qu'il trouve, si. */
    if (propre(requete.body.site, 200) !== '') {
      requete.log.info({ motif: 'leurre' }, 'message écarté');
      return reponse.code(202).send({ recu: true });   // même réponse qu'un vrai
    }

    /* ── Le délai de remplissage ── */
    const ouvertPendant = Number(requete.body.ouvertPendant ?? 0);
    if (!Number.isFinite(ouvertPendant) || ouvertPendant < config.delaiMinimalMs) {
      requete.log.info({ motif: 'trop rapide', ouvertPendant }, 'message écarté');
      return reponse.code(202).send({ recu: true });
    }

    /* ── Ce qu'un humain peut se tromper à écrire ──
     * Ici, en revanche, on le lui dit : c'est peut-être une faute de frappe. */
    if (!nom || !courriel || !message) {
      return reponse.code(400).send({ erreur: 'champs-manquants' });
    }
    if (!ADRESSE.test(courriel)) {
      return reponse.code(400).send({ erreur: 'adresse-invalide' });
    }

    const jeton = randomUUID();
    const recuLe = new Date();

    /* ── Les deux dépôts, chacun de son côté ── */
    const [courrierEnvoye, archiveFaite] = await Promise.allSettled([
      envoyer({ nom, courriel, message, langue, jeton }),
      archiver({
        nom, courriel, message, langue, jeton, recuLe,
        /* Ce qu'on NE garde PAS : ni adresse du visiteur, ni identifiant de
         * navigateur. On n'en a aucun usage, donc on ne les stocke pas. */
      }),
    ]);

    const courrierOk = courrierEnvoye.status === 'fulfilled';
    const archiveOk = archiveFaite.status === 'fulfilled';

    if (!courrierOk) {
      requete.log.error(
        { jeton, cause: courrierEnvoye.reason?.message },
        'le courrier n’est pas parti'
      );
    }
    if (!archiveOk) {
      requete.log.error(
        { jeton, cause: archiveFaite.reason?.message },
        'le message n’a pas été archivé'
      );
    }

    /* Rien n'a marché : là seulement, le visiteur voit une erreur — sans quoi
     * on lui dirait « merci » pour un message parti nulle part. */
    if (!courrierOk && !archiveOk) {
      return reponse.code(502).send({ erreur: 'rien-na-abouti' });
    }

    requete.log.info(
      { jeton, courrier: courrierOk, archive: archiveOk },
      'message reçu'
    );
    return reponse.code(202).send({ recu: true });
  });

  /* Un point de contrôle, pour savoir de l'extérieur si le service vit. */
  app.get('/api/sante', async () => ({ vivant: true }));
}
