/* L'archive des messages.
 *
 * Deuxième exemplaire, jamais le premier : le message part d'abord par
 * courrier, et cette base sert à le retrouver si le courrier se perd. C'est
 * pourquoi une panne de base ne doit jamais empêcher un envoi (voir la route).
 */

import { MongoClient } from 'mongodb';
import { config } from './config.js';

let client = null;
let base = null;

export async function connecter(log) {
  client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  base = client.db(config.mongoDb);

  /* Les messages s'effacent tout seuls au bout du délai annoncé sur la page
   * « Mentions ». Une promesse de suppression qu'il faudrait tenir à la main
   * ne serait pas tenue. */
  const secondes = config.conservationMois * 30 * 24 * 3600;
  await base.collection('messages').createIndex(
    { recuLe: 1 },
    { expireAfterSeconds: secondes, name: 'peremption' }
  );

  log?.info(
    { base: config.mongoDb, conservation: config.conservationMois + ' mois' },
    'archive prête'
  );
}

export async function archiver(message) {
  if (!base) throw new Error('archive non connectée');
  /* Confirmation par le seul serveur principal : on ne veut pas qu'un
   * incident réseau entre deux machines fasse échouer le message d'un
   * visiteur. Réglage posé ici, sur cette écriture, et nulle part ailleurs. */
  return base.collection('messages').insertOne(message, {
    writeConcern: { w: 1, wtimeout: 2000 },
  });
}

export async function fermer() {
  await client?.close();
  client = null;
  base = null;
}

export const estConnectee = () => base !== null;
