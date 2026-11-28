# Décision 3 : dossier à remettre à un juriste congolais

Rédigé le 2026-11-28. **Je ne suis pas juriste.** Ce document décrit ce que l'application fait réellement et pose des **questions**. Aucune loi, aucun article, aucun régulateur n'est cité comme une obligation : tout ce qui est juridique reste « à vérifier par le juriste ». Citations « fichier:ligne » au commit `10a8aeb`.

À remettre au juriste avec : ce fichier, le plan des écrans (replica/screens/ si utile), et un accès à une version de démonstration (jamais à des données réelles).

Résumé du produit en trois phrases : une place de marché d'articles d'occasion entre particuliers à Kinshasa et en RDC. L'acheteur paie par mobile money ; l'argent est gardé (« séquestre ») jusqu'à la remise en main propre (confirmée par un code à 6 chiffres) ou, pour la livraison par coursier, jusqu'à une fenêtre de réclamation de 48 h ; l'assistance tranche les litiges. La plateforme prélève des frais (valeurs PLACEHOLDER : 5 % côté acheteur, minimum 0,50 $ ; 1 % sur les retraits ; src/lib/fees.ts:27-28).

## A. Documents à faire écrire, et ce que l'application fait réellement

### A.0 État actuel
- Aucun document n'existe. L'écran S20 est un **stub** (src/app/legal/page.tsx:5).
- Aucune case « j'accepte les conditions » à l'inscription : l'inscription se fait par numéro + code SMS, sans lien vers des conditions (aucune occurrence dans src/components/client/SignInForm.tsx).
- Aucun contrôle d'âge ni de date de naissance dans le code ou la base (recherche dans src et db : rien).
- Seule page « règles » réelle : `/legal/articles-interdits` (voir C).

### A.1 Données collectées (ce que la base contient)

| Donnée | Où | Détail | Visible de qui |
| --- | --- | --- | --- |
| Numéro de téléphone (E.164) | `profiles.phone` (db/migrations/0001_core.sql:38-41) | identité du compte ; nul après suppression | l'assistance ; **pas** les autres membres (à vérifier dans l'interface) |
| Nom affiché (2 à 40 car.), biographie (500), avatar, langue, zone (commune) | `profiles` | choisis par le membre | autres membres |
| Rôle, statut (actif, suspendu, banni), niveau de vérification, note moyenne | `profiles` | | |
| Annonces : titre, description, prix, état, marque, catégorie, commune, photos (jusqu'à 20) | `items`, `item_photos`, `photo_blobs` | photos stockées **en base**, servies publiquement avec cache d'un an (src/app/api/v1/photos/[id]/route.ts:17) | public (annonce active) |
| Position GPS des photos | — | **retirée côté appareil** avant envoi (src/components/client/image.ts:8) | — |
| Messages (2 000 car. max), offres, un signalement automatique si numéro de téléphone ou lien détecté (`flagged`) | `messages` (0001_core.sql:206-216) ; détection src/lib/messaging.ts:10-16 | **le contenu est lu par la machine** pour détecter les échanges hors plateforme ; l'assistance peut-elle lire les messages ? à clarifier | les deux interlocuteurs ; assistance (à confirmer) |
| Photos privées (messages, preuves de litige) | `private_photos` (0006) | réservées aux participants et à l'assistance (litige) | participants |
| Commandes : adresse de remise (commune, repère), mode, montants, **numéro mobile money utilisé** | `orders`, `payments.msisdn`, `payouts.msisdn` (data.ts:98, 104) | **ces numéros restent après suppression du compte** (voir A.4) | assistance, comptabilité |
| Grand livre (mouvements d'argent) | `ledger_entries` | conservé | |
| Litiges : motif, description, échanges, preuves | `disputes`, `dispute_evidence` | | participants, assistance |
| Avis | `reviews` | | public |
| Signalements et sanctions | `reports`, `sanctions` (0001_core.sql:489-514) | motif, détail 1 000 car. | assistance |
| Appareils (jeton de notification), sessions (agent utilisateur, dates) | `devices`, `sessions` | jetons de session stockés en empreinte | |
| Codes SMS (empreinte), compteurs de limite (empreinte du numéro et de l'IP tronquée) | `otp_codes`, `rate_limits` | aucune IP ni numéro en clair (backend.md, checklist) | |
| Pièces d'identité | `identity_verifications` (0001_core.sql:73-86) | **table prévue, aucun écran ni route ne les collecte aujourd'hui**, seule la suppression de compte les efface (data.ts:611) | — |
| Journal d'audit | `audit_log` | acteur, action, cible, méta | assistance |
| Événements du PSP | `webhook_events` | charge utile complète du PSP | |

### A.2 Sous-traitants (aucun encore choisi ; à lister dans la politique de confidentialité, backend.md checklist sécurité, dernière case)

| Rôle | Fournisseur | Données qui lui parviennent | Statut |
| --- | --- | --- | --- |
| Base de données (PostgreSQL géré) | à choisir | toutes | non créé (backend.md) |
| Hébergement de l'application | à choisir | toutes en transit ; journaux | non choisi |
| Fournisseur SMS | à choisir (décision 2) | numéro, texte du SMS | non choisi |
| Prestataire de paiement mobile money | à choisir (décision 1) | numéro payeur, montant, devise, références | non choisi |
| Stockage objet des photos (plus tard) | à choisir | photos | prévu (backend.md, risque 6) |
| Supervision / alertes (éventuel) | à choisir | journaux | non choisi |
| Coursiers partenaires (saisis à la main par le vendeur) | externes | adresse de remise ? (à vérifier dans l'écran de livraison) | existent hors système |

Questions : lieu d'hébergement des données personnelles (en RDC, hors RDC) autorisé ? Transfert vers l'étranger : conditions ? Liste de sous-traitants à publier ?

### A.3 Documents à écrire, et pour chacun les questions

| Document | Ce que l'application fait (à décrire) | Questions pour le juriste |
| --- | --- | --- |
| **Conditions d'utilisation** | inscription par téléphone ; annonces ; achat avec séquestre ; remise par code ; litiges tranchés par l'assistance ; suspension 7 jours sur signalement (data.ts:1510) ; frais de la plateforme | Qui est « le contractant » (entité à créer, nom, adresse) ? Loi applicable, tribunal compétent ? Langue (français seul, ou aussi lingala/swahili) ? Clauses de responsabilité, de modification unilatérale ? Faut-il un recueil du consentement (case à cocher) à l'inscription ? |
| **Politique de confidentialité** | tableau A.1, sous-traitants A.2, durées A.4 | Contenu obligatoire ? Base légale ? Droits des personnes (accès, rectification, effacement) et délai de réponse ? Autorité de protection des données à déclarer ? Désigner un responsable ? |
| **Mentions légales** | éditeur, hébergeur, contact | Contenu obligatoire pour un service en ligne en RDC ? Numéro d'enregistrement, adresse physique ? |
| **Règles de la plateforme** (comportement, avis, interdits, messagerie, remise en main propre) | voir C, D | Quelles règles sont opposables ? Forme d'acceptation ? |
| **Règles du séquestre et des remboursements** | voir B et E | Peut-on promettre un remboursement ? Texte exact des délais ? |
| **Charte de modération** (sanctions, appel) | voir D | Procédure d'appel obligatoire ? |
| **Texte de consentement SMS** | SMS de service (code, commande, litige) | Consentement distinct requis pour les SMS de service ? Mention de l'expéditeur ? |

### A.4 Durées de conservation **actuellement dans le code** (aucune n'a été décidée juridiquement)

| Donnée | Durée dans le code | Source |
| --- | --- | --- |
| Code SMS | 5 minutes ; supprimé ensuite par la tâche `purge_expired` | pg/data.ts:487-488, 648 |
| Session | 30 jours ; supprimée à l'expiration | data.ts:563, 649 |
| Compteurs de limite (rate_limits) | 1 jour | data.ts:650 |
| Notifications lues | 90 jours après lecture ; les non lues restent | notifications.ts:161 ; data.ts:1640 |
| Commandes, paiements, grand livre, litiges, avis, signalements, sanctions, journal d'audit, événements PSP | **aucune suppression automatique** | pas de purge dans src/lib/jobs.ts |
| Messages et photos privées | **aucune suppression automatique** (sauf cascade à la suppression d'une commande ou d'une conversation ; non prévu à ce jour) | idem |
| Annonces et photos publiques | conservées ; une annonce retirée reste en base | data.ts:605 (statut « removed ») |
| Pièces d'identité | colonne `purge_after` prévue, **aucune tâche ne l'applique** | 0001_core.sql:81 |

**Suppression de compte** (data.ts:592-617) : refusée s'il reste une commande ouverte ou de l'argent au portefeuille (l.597-604). Sinon : annonces actives/brouillons retirées, sessions, favoris, appareils, notifications, préférences et pièces d'identité supprimés ; le profil devient « Membre supprimé », sans téléphone, avatar, zone, bio (l.612-615). **Restent** : les commandes passées, les **numéros mobile money dans `payments` et `payouts`**, les **messages** (l'émetteur reste référencé), les photos privées, les avis, le journal d'audit. Questions : quelle durée de conservation légale (comptabilité, lutte contre la fraude) justifie de garder commandes et numéros ? À partir de quand anonymiser aussi ces numéros ? Les messages doivent-ils être effacés ou anonymisés ?

## B. Rôle de la plateforme dans le séquestre : QUESTIONS seulement

Fonctionnement réel : l'acheteur paie le total (prix + livraison + frais de protection) au PSP ; le grand livre enregistre une somme « en séquestre » (src/lib/ledger.ts, `holdEntries`) ; à la remise, l'argent passe au solde vendeur moins les frais ; le vendeur retire vers son mobile money (frais 1 %, minimum). L'argent est en réalité **chez le PSP** ; l'application ne tient qu'une comptabilité. Elle peut aussi décider seule d'un remboursement (annulation d'une commande jamais remise après 7 jours, colis non livré après 10 jours : valeurs PLACEHOLDER, fees.ts:35, 43) ou trancher un litige.

Questions à poser :
1. Garder de l'argent pour le compte de tiers jusqu'à un événement, est-ce, en RDC, une activité de paiement ou de monnaie électronique nécessitant un agrément, une licence ou un partenariat avec un établissement agréé ? Quelles autorités consulter (nom exact, à vérifier par vous) ?
2. Si oui : peut-on s'appuyer sur la licence du PSP (le PSP détient les fonds, nous ne faisons que des instructions) ? Quelles clauses contractuelles seraient nécessaires ? Le PSP exige-t-il un statut précis ?
3. Une entité locale est-elle nécessaire (société, représentant, compte bancaire local) ? Fiscalité sur les frais perçus (taxe, TVA) et obligations de déclaration des vendeurs ?
4. Les fonds en attente chez le PSP : qui en est le titulaire juridique, que se passe-t-il en cas de faillite du PSP ou de la plateforme ?
5. Lutte contre le blanchiment et connaissance du client : un simple numéro de téléphone suffit-il ? Seuils de montants au-delà desquels une identification est exigée ? Obligations de signalement ?
6. Devises : accepter et conserver USD et CDF est-il autorisé ? Taux de change affiché : obligations ?
7. Plafonds d'une place de marché (valeur max par article actuellement 1 000 USD, fees.ts:29, PLACEHOLDER) : y a-t-il des limites réglementaires ?
8. Remboursement automatique sans accord du vendeur : base contractuelle suffisante dans les conditions ?
9. Les frais de « protection acheteur » peuvent-ils être qualifiés de service d'assurance ou de commission réglementée ?

## C. Liste d'articles interdits actuelle (à valider)

Source : src/lib/prohibited.ts:38-146 (valeurs par défaut) ; modifiable en base après lancement (page de gestion dans l'espace assistance ; migration 0009). Les **mots-clés ne sont pas reproduits** ici (ils restent secrets : ils ne sont jamais publiés ni renvoyés au vendeur, prohibited.ts:11-12). Le fichier même le dit (prohibited.ts:3-4) : « base de travail prudente... à valider par un juriste local ».

| # | Libellé public | Message montré au vendeur en cas de refus |
| --- | --- | --- |
| 1 | Armes et munitions | Les armes, les munitions et leurs accessoires ne peuvent pas être vendus ici. Retire-les de ton annonce. |
| 2 | Drogues et stupéfiants | Les drogues, les stupéfiants et leurs dérivés sont interdits à la vente. Cette annonce ne peut pas être publiée. |
| 3 | Médicaments | Les médicaments (surtout sur ordonnance) ne peuvent pas être vendus entre particuliers. Passe par une pharmacie agréée. |
| 4 | Produits contrefaits | Les contrefaçons et les imitations de marque sont interdites. Ne vends que des articles authentiques. |
| 5 | Animaux protégés, ivoire et trophées | Les animaux protégés, l'ivoire et les trophées de faune sauvage sont interdits à la vente. |
| 6 | Documents officiels | Les documents officiels (pièces d'identité, passeports, diplômes, actes) ne se vendent pas, authentiques ou non. |
| 7 | Matériel volé | Les articles volés ou de provenance douteuse sont interdits. Si tu as un doute sur l'origine d'un article, ne le vends pas. |
| 8 | Contenu pour adultes | Le contenu et les articles à caractère sexuel ne sont pas autorisés sur la plateforme. |
| 9 | Produits dangereux | Les explosifs, les produits chimiques dangereux et les matières radioactives sont interdits à la vente. |
| 10 | Minerais bruts non certifiés | Les minerais bruts (or, diamant, coltan, cobalt, cassitérite) ne se vendent pas ici : leur commerce est réglementé. |
| 11 | Uniformes et insignes officiels | Les uniformes, galons et insignes de l'armée ou de la police ne peuvent pas être vendus. |
| 12 | Cartes et comptes piratés | Les cartes bancaires clonées, comptes piratés et identifiants volés sont interdits. |

Questions : (1) Cette liste est-elle complète au regard du droit congolais (armes, stupéfiants, médicaments, faune, minerais, documents, matériel militaire, devises et titres, alcool, tabac, produits d'occasion à risque comme téléphones sans preuve d'origine, pièces d'automobiles, animaux vivants, denrées, cosmétiques, produits de santé) ? (2) Quels articles sont licites à certaines conditions (ex. médicaments : pharmacie) ? (3) Les formulations « le commerce est réglementé » du n° 10 sont-elles exactes ? (4) Le matériel électronique d'occasion : faut-il exiger une preuve d'origine ? (5) Quelle responsabilité pour la plateforme d'une annonce qui passe le filtre ? (6) Obligation de retirer sur notification, délai, procédure ? (7) Peut-on rester silencieux sur le mot détecté ? (c'est le comportement actuel).

## D. Autres sujets à soumettre

**Protection des données** : voir A.1 à A.4. Questions supplémentaires : déclaration préalable ou autorisation à l'autorité de protection des données (nom à vérifier) ? Droit d'opposition aux SMS de service ? Que faire d'une demande d'accès : quel format ? Notification d'une fuite : délai, destinataire ? Durées de conservation maximales ? Les empreintes de numéros et d'IP restent des données personnelles ?

**Mineurs** : aucun contrôle d'âge aujourd'hui. Questions : âge minimal pour contracter / pour vendre ? Autorisation parentale ? Mention dans les conditions suffit-elle ? Un mineur peut-il ouvrir un compte mobile money ? Le contenu pour adultes est interdit (règle n° 8) ; faut-il des protections supplémentaires ?

**Contenu des messages** : la plateforme lit les messages pour repérer un numéro ou un lien et les marque (messaging.ts:10-16). Questions : faut-il informer les membres dans les conditions ? Peut-on conserver les messages pour les litiges ? Durée ? Accès de l'assistance : dans quels cas, avec quelle trace (journal d'audit) ? Réquisitions des autorités : procédure, délai, qui répond ?

**Photos privées** : accessibles aux seuls participants et à l'assistance pour un litige ; cache navigateur `private, max-age=3600` (build-log.md, risques) donc une photo peut rester lisible sur un appareil partagé après déconnexion. Questions : photos de personnes ou de documents envoyées par erreur ; droit à l'image ; consentement ; durée ; retrait sur demande ? Les photos d'annonces publiques peuvent montrer des visages ou des plaques d'immatriculation : règle ?

**Modération et sanctions** : signalement → l'assistance peut masquer l'annonce, rejeter, ou suspendre le membre **7 jours** et fermer ses sessions (data.ts:1501-1515) ; sanctions de type masquage, suspension, bannissement (table `sanctions`, 0001_core.sql:503-512). Le suspendu reçoit une notification. Questions : procédure contradictoire ou droit de réponse nécessaire ? Appel ? Motif communiqué ? Qui à l'assistance décide (rôle `support`, `moderator`, `admin`, 0001_core.sql:48) ? Trace conservée combien de temps ? Peut-on bannir définitivement ?

**Litiges et délais** (valeurs actuelles, toutes PLACEHOLDER sauf mention) :

| Délai | Valeur | Source |
| --- | --- | --- |
| Paiement d'une commande | 15 minutes, puis expiration | fees.ts:30 |
| Demande d'annulation de l'acheteur sans réponse du vendeur | 3 jours = vaut refus | fees.ts:36 |
| Commande payée jamais remise : remboursement automatique | 7 jours | fees.ts:35 |
| Colis remis au coursier, jamais livré : remboursement automatique | 10 jours | fees.ts:43 |
| Fenêtre de réclamation après livraison par coursier, puis libération automatique au vendeur | 48 heures | fees.ts:34 ; data.ts:1711 |
| Essais du code de remise | 5 essais puis blocage 15 minutes | fees.ts:31-32 |
| Motifs de litige | non reçu, endommagé, non conforme, autre | schemas.ts:68 |

Questions : ces délais sont-ils acceptables (droit des consommateurs, délais de rétractation) ? Le code de remise vaut-il acceptation et décharge de l'article ? Valeur probante des échanges et des photos ? Décision de l'assistance : valeur contractuelle, voie de recours (médiation, tribunal) ? Responsabilité en cas de produit dangereux ou défectueux ? Qui supporte la perte d'un colis avec un coursier tiers que le vendeur a choisi (build-log.md : « personne ne verse la livraison au coursier ») ?

## E. Textes des stubs légaux actuels (src/app/legal/**)

**src/app/legal/page.tsx** (écran S20 ; titre de la page « Conditions et confidentialité ») : l'écran affiche un message générique « Bientôt disponible » (src/components/ui.tsx:200-210) : « Cet écran (S20) est prévu au jalon M1. » suivi de : « Un avis juridique local est nécessaire avant le lancement public. »

**src/app/legal/articles-interdits/page.tsx** (page réelle, publique, titre « Ce qu'on ne peut pas vendre », description « La liste des articles interdits à la vente sur la plateforme. »). Textes fixes :
- Introduction : « Pour protéger les acheteurs comme les vendeurs, certains articles ne peuvent pas être publiés. Une annonce qui en mentionne un dans son titre, sa description ou sa marque est refusée et reste en brouillon : rien n'est mis en ligne. »
- Puis la liste des 12 règles (libellé + message, voir C), lue en base.
- Pied : « Un doute sur un article ? Mieux vaut ne pas le publier. Tu peux aussi signaler une annonce qui ne respecte pas ces règles depuis sa fiche. Cette liste évolue : elle n'est pas exhaustive. »
- Bouton : « Retour au formulaire de vente ».
- Lien depuis le formulaire de vente : « Avant de publier : ce qu'on ne peut pas vendre. » (src/components/client/SellForm.tsx:88).

Remarques : le ton est le tutoiement ; à valider. « Rien n'est mis en ligne » : à vérifier par le juriste si cela suffit comme avertissement.

## F. Liste de pièces à remettre au juriste

- [ ] ce dossier ;
- [ ] schéma des données (replica/schema.sql, db/migrations/) ;
- [ ] descriptif du parcours d'achat avec séquestre (replica/architecture.md) ;
- [ ] textes des SMS (décision 2, §6) ;
- [ ] questionnaire reçu de chaque PSP (décision 1) et leurs réponses écrites sur la licence ;
- [ ] projet de nom de société, de marque et de domaine ;
- [ ] décision sur le périmètre du pilote (décision 4, §10).
