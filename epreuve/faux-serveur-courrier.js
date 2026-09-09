/* Un serveur de courrier de pacotille, pour le banc d'essai local.
 *
 * Il parle juste assez de SMTP pour qu'un vrai client croie lui parler, et
 * écrit chaque message reçu dans un fichier. Il ne relaie rien, ne chiffre
 * rien, n'authentifie personne : il n'a rien à faire ailleurs que sur cette
 * machine, pour vérifier qu'un message est bien PARTI et à quoi il ressemble.
 *
 * Usage : node epreuve/faux-serveur-courrier.js <port> <fichier-de-sortie>
 */

import net from 'node:net';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 2525);
const sortie = process.argv[3] ?? 'epreuve/bac/courrier-recu.txt';

fs.mkdirSync(new URL('.', 'file://' + process.cwd() + '/' + sortie).pathname, { recursive: true });

const serveur = net.createServer((flux) => {
  let dansLesDonnees = false;
  let message = [];
  let enveloppe = { de: null, vers: [] };

  const repondre = (ligne) => flux.write(ligne + '\r\n');
  repondre('220 banc-essai.local ESMTP');

  let reste = '';
  flux.on('data', (paquet) => {
    reste += paquet.toString('utf8');
    let coupure;
    while ((coupure = reste.indexOf('\r\n')) !== -1) {
      const ligne = reste.slice(0, coupure);
      reste = reste.slice(coupure + 2);

      if (dansLesDonnees) {
        if (ligne === '.') {
          dansLesDonnees = false;
          fs.appendFileSync(sortie,
            '\n===== MESSAGE ' + new Date().toISOString() + ' =====\n' +
            'enveloppe de   : ' + enveloppe.de + '\n' +
            'enveloppe vers : ' + enveloppe.vers.join(', ') + '\n' +
            '-----\n' + message.join('\n') + '\n');
          message = [];
          repondre('250 2.0.0 Ok: message enregistre');
        } else {
          message.push(ligne);
        }
        continue;
      }

      const commande = ligne.toUpperCase();
      if (commande.startsWith('EHLO') || commande.startsWith('HELO')) {
        /* On n'annonce PAS STARTTLS : le service doit pouvoir envoyer en
         * clair, comme il le fera par le tunnel privé. */
        repondre('250-banc-essai.local');
        repondre('250 SIZE 10485760');
      } else if (commande.startsWith('MAIL FROM')) {
        enveloppe.de = ligne.slice(ligne.indexOf(':') + 1).trim();
        repondre('250 2.1.0 Ok');
      } else if (commande.startsWith('RCPT TO')) {
        const dest = ligne.slice(ligne.indexOf(':') + 1).trim();
        /* On imite le vrai serveur : il n'accepte que ses propres domaines,
         * et refuse de relayer vers l'extérieur. */
        if (/@(chalou\.link|tonik\.ink)>?$/i.test(dest)) {
          enveloppe.vers.push(dest);
          repondre('250 2.1.5 Ok');
        } else {
          repondre('554 5.7.1 Relay access denied');
        }
      } else if (commande === 'DATA') {
        dansLesDonnees = true;
        repondre('354 Envoyez le message, terminez par un point seul');
      } else if (commande === 'QUIT') {
        repondre('221 2.0.0 Au revoir');
        flux.end();
      } else if (commande === 'RSET') {
        enveloppe = { de: null, vers: [] };
        repondre('250 2.0.0 Ok');
      } else {
        repondre('250 2.0.0 Ok');
      }
    }
  });

  flux.on('error', () => {});
});

serveur.listen(port, '127.0.0.1', () => {
  console.log('faux serveur de courrier : 127.0.0.1:' + port + ' → ' + sortie);
});
