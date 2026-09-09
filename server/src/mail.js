/* L'envoi du courrier.
 *
 * Chemin : ce serveur → mx.tonik.ink, port 587, TLS exigé, authentifié — la
 * règle de la maison, sans exception. Le pourquoi est en tête de config.js,
 * avec les trois refus qui empêchent d'en sortir. (Cet en-tête disait le
 * contraire jusqu'au 2026-09-09 : il décrivait l'ancien envoi par le port 25,
 * que le code refuse depuis le 2026-09-07.)
 */

import nodemailer from 'nodemailer';
import { config } from './config.js';

let transport = null;

const obtenirTransport = () => {
  if (!transport) {
    transport = nodemailer.createTransport({
      /* La règle de la maison, et rien d'autre : le serveur désigné par son
       * NOM, le port 587, l'élévation TLS exigée et vérifiée, et une
       * authentification. Le pourquoi est en tête de config.js, avec les trois
       * refus qui empêchent d'en sortir.
       *
       * Ce que ce réglage a remplacé, et pourquoi : un envoi sans mot de passe
       * vers l'adresse numérique du tunnel, sur le port 25. Il marchait — les
       * messages partaient et arrivaient — mais ils entraient par la porte du
       * courrier venu du dehors, et le filtre les rangeait tous dans les
       * indésirables. Panne constatée le 2026-09-07, invisible depuis le
       * service : il croyait avoir réussi. */
      host: config.smtpHost,
      port: config.smtpPort,
      secure: false,        // le port 587 démarre en clair…
      requireTLS: true,     // …et DOIT être élevé en chiffré, sinon on renonce
      auth: { user: config.smtpUser, pass: config.smtpPass },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 15000,
    });
  }
  return transport;
};

/* Un retour à la ligne glissé dans un champ permettrait d'ajouter des
 * en-têtes au message — un destinataire caché, par exemple. On les retire. */
const surUneLigne = (v) => String(v).replace(/[\r\n]+/g, ' ').trim();

export async function envoyer({ nom, courriel, message, langue, jeton }) {
  const sujet = `[chalou.link] ${surUneLigne(nom)}`;

  const corps =
    `De   : ${surUneLigne(nom)} <${surUneLigne(courriel)}>\n` +
    `Langue : ${surUneLigne(langue)}\n` +
    `Reçu : ${new Date().toISOString()}\n` +
    `Repère : ${jeton}\n` +
    '\n' +
    '─'.repeat(60) + '\n\n' +
    message + '\n';

  const info = await obtenirTransport().sendMail({
    from: config.mailFrom,
    to: config.mailTo,
    /* L'adresse du visiteur ne sert qu'à répondre : elle n'est jamais
     * destinataire, jamais expéditeur. */
    replyTo: `${surUneLigne(nom)} <${surUneLigne(courriel)}>`,
    subject: sujet,
    text: corps,
  });

  return info.messageId;
}

/* Une alerte à Charles, quand quelque chose a raté sans visiteur pour le voir
 * (le webhook FadeBeat, par exemple). Même chemin, même identité que le
 * formulaire. Ne jette jamais : l'appelant a déjà répondu, une alerte qui
 * échoue se journalise, elle ne casse rien de plus. */
export async function envoyerAlerte({ sujet, texte, log }) {
  try {
    const info = await obtenirTransport().sendMail({
      from: config.mailFrom,
      to: config.mailTo,
      /* « [WARN] » : c'est le mot que le filtre du serveur de courrier
       * reconnaît pour ranger le message dans le dossier « Alertes » de
       * Charles (règle 5 du filtre global, lue le 2026-09-09). */
      subject: `[WARN] chalou.link — ${surUneLigne(sujet)}`,
      text: texte + '\n',
    });
    log?.info({ messageId: info.messageId }, 'alerte envoyée');
    return true;
  } catch (e) {
    log?.error({ cause: e.message }, "l'alerte n'est pas partie");
    return false;
  }
}

export async function fermer() {
  transport?.close();
  transport = null;
}
