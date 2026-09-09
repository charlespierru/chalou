# Zone DNS de `chalou.link` — relevé exhaustif du 2026-09-08

**Pourquoi ce document** : un déplacement de zone (ou une modification à la
main) se rate en perdant un enregistrement qu'on n'avait pas vu. Ce relevé est
la référence à reproduire à l'identique, puis à comparer après tout geste.

**Comment il a été fait (mesuré, 2026-09-08)** : interrogation directe du
serveur autoritaire `dns1.registrar-servers.com` (Namecheap), pour chaque nom
connu, sur les types A, AAAA, CNAME, MX, TXT, SRV, CAA, NS. Le transfert de
zone (AXFR) est refusé par Namecheap, donc le relevé porte sur les noms connus
(les six sous-domaines vivants, les sélecteurs DKIM et les noms `_dmarc`) plus
des sondes sur des noms courants (autoconfig, autodiscover, `_acme-challenge`,
services SRV usuels, joker `*`) : toutes vides. Autorité : `dns1` et `dns2`
répondent identiquement.

**Contre-vérification à faire par Charles avant tout déplacement** : ouvrir
Namecheap → Domain List → `chalou.link` → Advanced DNS, déplier SHOW MORE, et
compter les lignes du tableau Host Records. Attendu **au moment du relevé** :
**31 lignes** (les 33 du relevé moins les 2 NS, qui ne figurent pas dans ce
tableau) — et **32 lignes depuis le 2026-09-08 vers 02:30**, le TXT DKIM
`mx202609._domainkey` ayant été ajouté (voir la section suivante). Si le compte
diffère, une ligne m'a échappé : la relever avant de bouger.

## Résumé en clair

- **Autorité** : Namecheap (`dns1`/`dns2.registrar-servers.com`), durée de vie 1800 s (30 min).
- **Aucun** AAAA, SRV, CAA, ni joker. **Aucun** CNAME hors les 8 DKIM de Brevo.
- **Six noms d'adresse** : `@`, `www`, `usa` → serveur web `187.124.46.195` ;
  `mail`, `clannik`, `soleneceramic` → serveur de courrier `187.77.168.112` ;
  `elise` → OVH `51.79.85.101`.
- **Courrier** : MX `10 mail.chalou.link` sur `@`, `clannik`, `soleneceramic`,
  `elise` (pas sur `www`, `usa`, `mail`).
- **SPF** identique sur ces 4 mêmes noms : `v=spf1 include:spf.brevo.com -all`.
- **DMARC** identique sur ces 4 noms : `v=DMARC1; p=quarantine`, sans adresse de rapport.
- **Brevo** : `brevo-code` (code de compte, même valeur) sur ces 4 noms, et
  2 CNAME DKIM (`brevo1`/`brevo2._domainkey`) sous chacun → 8 CNAME.

Total : **33 enregistrements** (2 NS + 7 A + 4 MX + 12 TXT + 8 CNAME) au moment du relevé —
**34 depuis le 2026-09-08 vers 02:30** (13 TXT), le TXT DKIM `mx202609._domainkey` ayant été
ajouté par le chantier #94.

## Ce que le chantier #94 a changé, et rien d'autre — APPLIQUÉ le 2026-09-08 vers 01:20

Saisi par l'extension Chrome dans le panneau Namecheap, puis relu sur `dns1`
ET `dns2.registrar-servers.com` : les deux valeurs « Après » sont en ligne, un
seul SPF sur `@` (mesuré). Le relevé brut ci-dessous reste l'état AVANT.

Décision de Charles du 2026-09-07 : « autorise mon serveur, ne touche pas à Brevo ».

| Nom | Avant | Après | Quand |
|---|---|---|---|
| `chalou.link` TXT SPF | `v=spf1 include:spf.brevo.com -all` | `v=spf1 ip4:187.77.168.112 include:spf.brevo.com -all` | 2026-09-08 ~01:20 |
| `_dmarc.chalou.link` TXT | `v=DMARC1; p=quarantine` | `v=DMARC1; p=quarantine; rua=mailto:charles@chalou.link` | 2026-09-08 ~01:20 |
| `mx202609._domainkey.chalou.link` TXT | **rien** (NXDOMAIN, mesuré à 01:52 sur `dns1`, `dns2`, `8.8.8.8`, `9.9.9.9` et depuis `hostingerd`) | la clé publique DKIM du serveur, 410 caractères, `v=DKIM1; k=rsa; p=…` — copie de référence dans `vps-tunnel/infra/courrier/dkim-chalou-link-mx202609.pub` | 2026-09-08 ~02:30 |

**Le TXT DKIM, ligne ajoutée le 2026-09-08 vers 02:30.** Saisie à la main dans le panneau
Namecheap (type `TXT Record`, host `mx202609._domainkey`, TTL `Automatic`), une seule chaîne
sans guillemets. **Vérifié caractère par caractère** : `dig +short TXT`, recollage des deux
morceaux du TXT long (`dig` insère un espace entre les chaînes de 255 caractères — la première
comparaison a donné 411 octets contre 410 pour cette seule raison), puis `cmp` contre le fichier
de référence : **410 octets, identiques**, sur `dns1` ET `dns2`. Visible ensuite sur `8.8.8.8`,
`9.9.9.9`, `1.1.1.1`, `8.8.4.4`. ⚠ Le résolveur de l'hébergeur (`153.92.2.6`) a mis **1 h 19**
à le voir (cache négatif, TTL du SOA 3601 s) : vu depuis `hostingerd` seulement à 02:37:31.
Aucune re-saisie n'a été faite pendant cette attente — c'est le piège à ne pas retomber dedans,
il aurait créé un TXT en double.

**Le compte passe donc à 34 enregistrements** (2 NS + 7 A + 4 MX + **13 TXT** + 8 CNAME).
Le contre-comptage à faire chez Namecheap (tableau *Host Records*, qui n'affiche pas les NS)
attend désormais **32 lignes**, et non 31.

La ligne SPF cible est exactement celle de `tonik.ink` (mesuré le 2026-09-08).
Le DMARC de `tonik.ink` porte `rua=mailto:postmaster@tonik.ink` (mesuré).
Pour `chalou.link`, `postmaster@chalou.link` est une boîte morte et un `rua`
vers un autre domaine exige une autorisation supplémentaire
(`BREVO-CHALOU-LINK.md` §7). La seule boîte vivante de Charles sur ce domaine
est `charles@chalou.link` (réception prouvée, PASSATION §1) : c'est elle qui
est celle qui a été posée.

Les trois sous-domaines (`clannik`, `soleneceramic`, `elise`) ne sont pas
touchés par cette décision : ils continuent d'envoyer par Brevo.

## Relevé brut (sortie `dig`, serveur autoritaire, 2026-09-08)

```
brevo1._domainkey.chalou.link.                   1799   IN    CNAME  b1.chalou-link.dkim.brevo.com. 
brevo1._domainkey.clannik.chalou.link.           1799   IN    CNAME  b1.clannik-chalou-link.dkim.brevo.com. 
brevo1._domainkey.elise.chalou.link.             1799   IN    CNAME  b1.elise-chalou-link.dkim.brevo.com. 
brevo1._domainkey.soleneceramic.chalou.link.     1799   IN    CNAME  b1.soleneceramic-chalou-link.dkim.brevo.com. 
brevo2._domainkey.chalou.link.                   1799   IN    CNAME  b2.chalou-link.dkim.brevo.com. 
brevo2._domainkey.clannik.chalou.link.           1799   IN    CNAME  b2.clannik-chalou-link.dkim.brevo.com. 
brevo2._domainkey.elise.chalou.link.             1799   IN    CNAME  b2.elise-chalou-link.dkim.brevo.com. 
brevo2._domainkey.soleneceramic.chalou.link.     1799   IN    CNAME  b2.soleneceramic-chalou-link.dkim.brevo.com. 
chalou.link.                                     1799   IN    A      187.124.46.195 
chalou.link.                                     1799   IN    MX     10 mail.chalou.link. 
chalou.link.                                     1799   IN    TXT    "brevo-code:1843295cee8df62472445f5bba2714bb" 
chalou.link.                                     1799   IN    TXT    "v=spf1 include:spf.brevo.com -all" 
chalou.link.                                     1800   IN    NS     dns1.registrar-servers.com. 
chalou.link.                                     1800   IN    NS     dns2.registrar-servers.com. 
clannik.chalou.link.                             1799   IN    A      187.77.168.112 
clannik.chalou.link.                             1799   IN    MX     10 mail.chalou.link. 
clannik.chalou.link.                             1799   IN    TXT    "brevo-code:1843295cee8df62472445f5bba2714bb" 
clannik.chalou.link.                             1799   IN    TXT    "v=spf1 include:spf.brevo.com -all" 
_dmarc.chalou.link.                              1799   IN    TXT    "v=DMARC1; p=quarantine" 
_dmarc.clannik.chalou.link.                      1799   IN    TXT    "v=DMARC1; p=quarantine" 
_dmarc.elise.chalou.link.                        1799   IN    TXT    "v=DMARC1; p=quarantine" 
_dmarc.soleneceramic.chalou.link.                1799   IN    TXT    "v=DMARC1; p=quarantine" 
elise.chalou.link.                               1799   IN    A      51.79.85.101 
elise.chalou.link.                               1799   IN    MX     10 mail.chalou.link. 
elise.chalou.link.                               1799   IN    TXT    "brevo-code:1843295cee8df62472445f5bba2714bb" 
elise.chalou.link.                               1799   IN    TXT    "v=spf1 include:spf.brevo.com -all" 
mail.chalou.link.                                1799   IN    A      187.77.168.112 
soleneceramic.chalou.link.                       1799   IN    A      187.77.168.112 
soleneceramic.chalou.link.                       1799   IN    MX     10 mail.chalou.link. 
soleneceramic.chalou.link.                       1799   IN    TXT    "brevo-code:1843295cee8df62472445f5bba2714bb" 
soleneceramic.chalou.link.                       1799   IN    TXT    "v=spf1 include:spf.brevo.com -all" 
usa.chalou.link.                                 1799   IN    A      187.124.46.195 
www.chalou.link.                                 1799   IN    A      187.124.46.195 
```

## Sondes vides (mesuré, 2026-09-08)

AAAA/CNAME/TXT/SRV/CAA sur les 7 noms d'adresse ; `_dmarc` et `brevo*._domainkey`
sous `www`, `usa`, `mail` ; sélecteurs `mx202609` (⚠ **vide au moment du relevé seulement** :
posé le 2026-09-08 vers 02:30, voir plus haut), `default`, `mail`, `dkim`,
`mx`, `k1`, `s1`, `s2` ; noms `autoconfig`, `autodiscover`, `_autodiscover._tcp`,
`_imaps._tcp`, `_submission._tcp`, `ftp`, `smtp`, `imap`, `webmail`, `api`, `dev`,
`staging`, `tonik`, `lutrin`, `fadebeat`, `_sip._tcp`, `_sips._tcp`,
`_xmpp-client._tcp`, `_xmpp-server._tcp`, `_caldavs._tcp`, `_carddavs._tcp`,
`_acme-challenge` ; joker (`zzz-inexistant-9f3.chalou.link`) : NXDOMAIN.

## Sources lues

- `vps-tunnel/docs/email/BREVO-CHALOU-LINK.md` §4, §12 (lignes posées à la main les 2026-08-02 et 2026-08-14 : cohérentes avec ce relevé, écart 0).
- `vps-tunnel/docs/BASCULE-DU-CENTOS-VERS-ROCKY-PLAN.md` (les trois voies d'accès à la zone).
- `landing-chalou/docs/PASSATION.md` §4.1.
