/* Formulaire de contact.
 *
 * Trois défenses contre les robots, aucune contre les humains :
 *   1. un champ leurre, invisible à l'écran ; un robot le remplit, pas vous ;
 *   2. un délai minimal : un formulaire rempli en moins de trois secondes
 *      n'a pas été rempli par quelqu'un qui lit ;
 *   3. côté serveur, une limite du nombre d'envois par minute.
 * Aucune n'oblige le visiteur à cliquer sur quoi que ce soit.
 */

const DELAI_MINIMAL_MS = 3000;

const form = document.getElementById('contact-form');
const statut = document.getElementById('statut');
const bouton = document.getElementById('envoyer');
const ouvertureALa = Date.now();

/* Les messages d'état sont bilingues comme le reste : on lit la langue
 * affichée au moment où on parle. */
const MESSAGES = {
  fr: {
    incomplet: 'Il manque quelque chose : votre nom, votre adresse ou votre message.',
    adresse: 'Cette adresse électronique ne semble pas valide.',
    tropVite: 'Prenez le temps de relire — puis renvoyez.',
    envoiEnCours: 'Envoi…',
    envoye: 'C’est parti. Merci — je vous réponds.',
    panne: 'Le message n’a pas pu partir. Réessayez dans un moment.',
    trop: 'Trop d’envois coup sur coup. Attendez une minute.',
  },
  en: {
    incomplet: 'Something is missing: your name, your address or your message.',
    adresse: 'That email address does not look valid.',
    tropVite: 'Take a moment to read it over — then send again.',
    envoiEnCours: 'Sending…',
    envoye: 'On its way. Thank you — I will get back to you.',
    panne: 'The message could not be sent. Please try again in a moment.',
    trop: 'Too many messages in a row. Please wait a minute.',
  },
};

const dire = (cle, type = 'erreur') => {
  const langue = document.documentElement.lang === 'en' ? 'en' : 'fr';
  statut.textContent = MESSAGES[langue][cle];
  statut.className = 'form-status ' + type;
};

const adresseValide = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const donnees = {
    nom: form.nom.value.trim(),
    courriel: form.courriel.value.trim(),
    message: form.message.value.trim(),
    site: form.site.value,                       // le leurre
    ouvertPendant: Date.now() - ouvertureALa,    // le délai
    langue: document.documentElement.lang,
  };

  if (!donnees.nom || !donnees.courriel || !donnees.message) return dire('incomplet');
  if (!adresseValide(donnees.courriel)) return dire('adresse');
  if (donnees.ouvertPendant < DELAI_MINIMAL_MS) return dire('tropVite');

  bouton.disabled = true;
  dire('envoiEnCours', 'attente');

  try {
    const reponse = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donnees),
    });

    if (reponse.ok) {
      form.reset();
      dire('envoye', 'succes');
      return;
    }
    dire(reponse.status === 429 ? 'trop' : 'panne');
  } catch {
    // Serveur injoignable : on le dit, on ne fait pas semblant d'avoir envoyé.
    dire('panne');
  } finally {
    bouton.disabled = false;
  }
});
