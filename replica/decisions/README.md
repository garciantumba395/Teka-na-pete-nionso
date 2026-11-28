# Dossiers de décision : index

Rédigés le 2026-11-28. Ces dossiers ne modifient aucun code. Ils préparent ce que **vous** devez décider, ouvrir ou signer, et disent ce que Claude peut faire ensuite. Rien n'a été créé chez un prestataire, aucune API appelée, aucun secret écrit. Tout point juridique est une **question** pour un juriste congolais.

| # | Fichier | Sujet | Décide |
| --- | --- | --- | --- |
| 1 | [01-choix-fournisseur-paiement.md](01-choix-fournisseur-paiement.md) | PSP mobile money : critères, questionnaire, comparatif, interface attendue, recette | vous |
| 2 | [02-choix-fournisseur-sms.md](02-choix-fournisseur-sms.md) | SMS : critères, textes à relire, plafonds | vous |
| 3 | [03-dossier-avis-juridique.md](03-dossier-avis-juridique.md) | dossier pour un juriste local | juriste puis vous |
| 4 | [04-liste-mise-en-production.md](04-liste-mise-en-production.md) | liste de contrôle, ordonnanceur, pilote | vous |

## Ordre recommandé et dépendances

```
3 (avis juridique, section B)  ──►  1 (choix du PSP)  ──►  adaptateur PSP (Claude)  ─┐
        │                                                                              ├─►  4 (liste de passage) ─► pilote limité
        └──────────────────────►  2 (choix SMS)  ──────►  adaptateur SMS (Claude)  ───┘
```

1. **Lancez les trois démarches longues le même jour** : l'avis juridique (3), le questionnaire aux PSP (1), le test de délivrabilité SMS (2). Le dossier d'ouverture de compte marchand (KYB) est le chemin critique (délai à demander au PSP).
2. La **section B du dossier 3** (le séquestre est-il une activité réglementée ?) peut éliminer un PSP ou changer le modèle : ne signez pas de contrat PSP avant d'avoir au moins une première réponse.
3. Les adaptateurs ne s'écrivent **qu'après** le choix **et** l'accès à un bac à sable (backend.md, ligne 7 : écrire un adaptateur « de mémoire » serait dangereux).
4. La liste 4 se remplit au fil de l'eau ; ses sections 1 à 9 sont des conditions d'entrée du pilote.

## Ce que vous devez faire vous-même

| Action | Dossier |
| --- | --- |
| Créer les comptes (PSP bac à sable puis réel, fournisseur SMS, hébergeur, base PostgreSQL) et leurs clés ; **les placer dans l'hébergeur, jamais dans le dépôt ni dans une conversation** | 1, 2, 4 |
| Constituer l'entité qui contracte (société, adresse, responsable) ; déposer les dossiers KYB | 1, 3 |
| Choisir et mandater un juriste congolais ; lui remettre le dossier 3 | 3 |
| Fixer un plafond de dépense SMS **chez le fournisseur** avant toute clé de production | 2 |
| Tester la délivrabilité SMS sur SIM réelles des 4 opérateurs ; tester sur de vrais téléphones | 2, 4 |
| Tester une restauration de sauvegarde de la base | 4 |
| Attribuer en base le rôle `support` (requête d'exemple du dossier 4, §5) | 4 |
| Valider les chiffres PLACEHOLDER : frais, délais, valeur maximale (src/lib/fees.ts:24-44) | 1, 3, 4 |
| Choisir le nom définitif (aujourd'hui « NomAppli », src/lib/copy.ts:4), qui change tous les SMS | 2 |
| Fixer le périmètre du pilote (plafonds, nombre de membres, communes) | 4 |
| Nommer l'astreinte et les agents d'assistance | 4 |

## Ce que Claude peut faire ensuite, une fois la décision prise

| Décision prise | Travail possible |
| --- | --- |
| PSP choisi + bac à sable ouvert | adaptateur `PaymentProvider`, vérification de signature propre au PSP, vérification du montant et de la devise dans les webhooks, relance automatique des remboursements échoués, tests de contrat contre le bac à sable, variables ajoutées à `.env.example` et au garde `productionProblems` |
| Fournisseur SMS choisi | adaptateur `SmsProvider`, plafond global quotidien, alerte de dépense, réécriture des textes, rapport de livraison |
| Avis juridique reçu | pages des conditions, de la confidentialité, des mentions légales ; case de consentement à l'inscription ; durées de conservation et tâches de purge ; anonymisation des numéros et messages à la suppression de compte ; ajustement de la liste d'articles interdits ; texte des délais |
| Périmètre du pilote | plafonds par membre, par jour et par retrait ; liste d'invitation ; restriction par commune ; interrupteur d'arrêt ; durcissement de `db:seed-demo` |
| Hébergeur choisi | configuration de l'ordonnanceur, des sondes et des alertes ; migration des photos vers un stockage objet |

## Risques de code relevés pendant la rédaction (non corrigés, à arbitrer)

- Le webhook n'a **pas de montant** : un encaissement partiel ou erroné serait accepté (dossier 1, §5).
- La route des webhooks n'accepte que `fake` (webhooks/psp/[provider]/route.ts:12).
- `db:seed-demo` ne se protège que par `NODE_ENV` du shell (seed.ts:49) (dossier 4, §6).
- `backend.md` décrit 3 tâches planifiées ; le code en compte 7 (jobs.ts:15-26) (dossier 4, §4).
- Suppression de compte : numéros mobile money et messages restent en base (data.ts:592-617) (dossier 3, §A.4).
- Aucune case d'acceptation des conditions, aucun contrôle d'âge (dossier 3, §A.0).
- Aucun plafond global de SMS, de montants par membre, de retraits, d'inscriptions (dossiers 2 et 4).

## Sources web utilisées (consultées le 2026-11-28)

PawaPay https://docs.pawapay.io · Twilio https://www.twilio.com/en-us/guidelines/cd/sms · Link Mobility https://docs.linkmobility.com/regulatory-guidelines/sender-id/democratic-republic-of-congo. Les autres adresses citées dans les dossiers viennent d'extraits de recherche et sont signalées comme **non ouvertes** ; rien d'autre n'est tenu pour un fait.
