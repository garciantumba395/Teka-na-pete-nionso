# Brief multilingue des agents (K à O)

À lire en entier, EN PLUS de `replica/agent-brief.md` (mise en route, ports, règles de fusion, définition de terminé). Ce brief décrit le travail de traduction ; l'autre décrit comment travailler dans une copie isolée. Aucune migration dans ce chantier.

## Principe
L'application est écrite en français. L'infrastructure multilingue est en place : `fr` (référence), `en`, `ln` (lingala), `sw` (swahili). Ta mission : **faire passer chaque texte visible de ta zone par le traducteur**, avec les 4 langues, sans changer le comportement ni le texte français.

**Le texte français ne change PAS d'un caractère** (ponctuation, apostrophes, espaces insécables compris) : les 200 tests existants vérifient le français et doivent continuer à passer sans modification.

## L'infrastructure (déjà là, ne la modifie pas ; demande-toi seulement comment l'utiliser)
- `src/i18n/ns/<nom>.ts` : un fichier par espace de noms, `{ name, client, fr, en, ln, sw }`, clés SANS préfixe ; clé complète `nom.cle`.
- **Composant serveur** : `const { t, locale } = await getT(user?.lang);` (`import { getT } from "@/i18n/server"`). Passe `user?.lang` si tu as déjà le membre ; sinon `getT()`.
- **Composant client** : `const { t, locale } = useI18n();` (`import { useI18n } from "@/i18n/client"`). Le dictionnaire client ne contient QUE les espaces avec `client: true` : si un composant client utilise un espace, cet espace doit être `client: true`. Garde les espaces serveur (`client: false`) hors du navigateur (poids du JS sur réseau lent).
- `t("espace.cle")`, `t("espace.cle", { nom: valeur })` avec `{nom}` dans le texte. **Pluriel** : écris `cle_one` et `cle_other` (et `{count}`), appelle `t("espace.cle", { count })`.
- **Métadonnées** (`export const metadata`) deviennent `export async function generateMetadata()` avec `getT`.
- **Dates et nombres** : `new Intl.DateTimeFormat(INTL_LOCALE[locale], { ..., timeZone: "Africa/Kinshasa" })` (`import { INTL_LOCALE } from "@/i18n/config"`). Le fuseau fixe reste obligatoire (hydratation). **Montants** : `formatMoney(minor, currency, locale)` (le 3ᵉ paramètre est nouveau ; sans lui, c'est le français).
- Le sélecteur de langue existe : `import { LanguageSwitcher } from "@/components/client/LanguageSwitcher"` (`compact` pour une version sans libellé visible).
- Une nouvelle clé s'ajoute à TON fichier d'espace de noms, jamais à celui d'un autre agent. Besoin d'un nouvel espace ? utilise ton `misc_<lettre>` (déjà déclaré et enregistré).

## Glossaire (même mot pour le même concept, dans tout le produit)
Anglais en orthographe britannique (« favourite », « colour »). Pour `ln` et `sw`, applique le même principe : **un concept = un mot, partout** ; si tu n'es pas sûr du mot, garde l'emprunt français (usage courant en RDC) et garde-le partout.
| Français | Anglais |
| --- | --- |
| annonce | listing |
| article | item |
| vendeur / acheteur | seller / buyer |
| commande | order |
| lot / panier | bundle / basket |
| remise en main propre | hand-over in person |
| code de remise | hand-over code |
| séquestre (argent bloqué) | held safely / held in escrow |
| protection acheteur | buyer protection |
| remboursement / rembourser | refund / to refund |
| litige | dispute |
| assistance | support |
| signalement / signaler | report / to report |
| avis | review |
| portefeuille | wallet |
| retrait / retirer l'argent | withdrawal / to withdraw |
| coursier | courier |
| frais de livraison | delivery fee |
| favoris | favourites |
| « Pour toi » | "For you" |
| mobile money | mobile money |
| commune | commune (district) |
Tutoiement du français → « you » ; pas de « please » à chaque phrase.

## Catégories
Les **noms de catégories** sont des DONNÉES traduites par l'agent **P** (pas par toi). Pour afficher une catégorie, appelle `categoryLabel(categorie, locale)` (`import { categoryLabel } from "@/lib/categories"`) : il renvoie le nom traduit, ou le français tant que la traduction n'existe pas. Ne copie pas le nom français d'une catégorie dans un espace de noms.

## Quoi traduire / ne pas traduire
**Traduire** : texte JSX, `aria-label`, `placeholder`, `title`, `alt`, libellés de `<option>`, messages d'erreur **produits côté client**, états vides, textes de boutons, `metadata.title`, listes de constantes de libellés (`copy.ts` : seulement TON bloc, voir ci-dessous).
**Ne PAS traduire** : contenu saisi par les membres (titres, descriptions, messages, noms), valeurs d'énumération envoyées au serveur (`"hand_delivery"`, `"mpesa"`…), codes d'erreur, URL, `data-testid`, noms propres (M-Pesa, Orange Money, Airtel Money, Africell Money, nom de l'application via `APP_NAME`).
**Messages venant du serveur** (`err.message` d'un `ApiError`, `details` de validation) : **ne les touche pas** : l'agent O les traduit côté serveur selon la langue de la requête. Les textes que ton composant écrit LUI-MÊME (« Erreur inattendue. », « Réessaie. »…) sont à toi.

## Qualité des traductions
- **Anglais** : naturel, court, ton direct comme le français (tutoiement → « you »). Interface d'une marketplace, pas de jargon.
- **Lingala (ln) et swahili (sw)** : statut **bêta**, à relire par des locuteurs natifs. Règles strictes : (1) n'écris une traduction que si tu es sûr qu'elle est correcte et naturelle ; **sinon laisse la clé absente** (le français s'affiche : un texte juste en français vaut mieux qu'un faux lingala) ; (2) mots simples, phrases courtes ; (3) les emprunts au français sont normaux en lingala parlé en RDC (« réseau », « téléphone », « compte »…) ; (4) garde noms propres, chiffres, devises, `{variables}` inchangés ; (5) pas de traduction mot à mot qui change le sens ; (6) en cas de doute sur le sens d'un message qui touche l'argent ou la sécurité (paiement, remboursement, code de remise, litige), laisse absent plutôt que d'inventer. Objectif de couverture : au moins 80 % des clés si tu es sûr, jamais au prix de la justesse.
- Les `{variables}` doivent être IDENTIQUES dans toutes les langues (un test le vérifie).

## Propriété des fichiers (ne touche à rien d'autre ; si un fichier hors zone doit changer, note-le dans ton rapport)
| Agent | Espaces de noms | Fichiers |
| --- | --- | --- |
| **K** | `auth`, `account`, `legal`, `misc_k` | `src/app/signin/**`, `src/app/me/**` (profil, préférences, réglages de notifications), `src/app/legal/**`, `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/offline/**`, `src/components/client/{SignInForm,OtpInput,InstallBanner,NotificationPrefs,FollowEditor,LogoutButton}.tsx`. **Ajoute le `LanguageSwitcher` (non compact) dans `/me` et sur `/signin`** : sur mobile c'est le seul endroit où l'on change de langue. La page hors-ligne `/offline` est mise en cache : écris-la dans les 4 langues empilées (fr, en, ln, sw), pas selon un cookie. Le manifeste (`manifest.ts`) reste en français. |
| **L** | `ui`, `catalog`, `sell`, `cart`, `misc_l` | `src/components/ui.tsx` (TOUT : `AppBar`, `Banner`, `EmptyState`, `ListingCard`, `OrderStepper`, `ShipmentTimeline`, `StubScreen`… ; les libellés d'étapes de commande vont dans `ui`), `src/app/(browse)/**`, `src/app/items/**`, `src/app/sell/**`, `src/app/favourites/**`, `src/app/members/**`, `src/app/cart/**`, `src/components/client/{SellForm,PhotoPicker,FavouriteButton,AddToCartButton,CartLots,BuyButton,StartChatButton}.tsx`. `CONDITIONS` (libellés des états) : dans `catalog`. |
| **M** | `orders`, `pay`, `wallet`, `courier`, `misc_m` | `src/app/orders/**` **sauf** `orders/[id]/dispute` et `orders/[id]/review` (N), `src/app/wallet/**`, `src/components/client/{PayForm,PayoutForm,OrderPanels,CancelRequest,CourierPanels,DeliveryChoice,CourierFees}.tsx`, `src/lib/copy-courier.ts`, `src/lib/datetime.ts`, dans `src/lib/copy.ts` : **seulement** `PAYMENT_METHODS` (noms propres : ne change rien) et `ORDER_STATUS_LABEL` (`NAV` est déjà couvert par l'espace `shell` : n'y touche pas) (→ clés `orders.status_*`, garde une fonction qui renvoie le texte traduit). |
| **N** | `messages`, `notifications`, `notifytexts`, `disputes`, `reviews`, `reports`, `staff`, `misc_n` | `src/app/inbox/**`, `src/app/notifications/**`, `src/app/report/**`, `src/app/staff/**`, `src/app/orders/[id]/dispute/**`, `src/app/orders/[id]/review/**`, `src/components/client/{ChatThread,DisputeForms,ReviewForm,ReportForm,NotificationList,PhotoAttach,PhotoView}.tsx`, `src/lib/notifications.ts` (textes des notifications ET des **SMS**), dans `src/lib/copy.ts` : `DISPUTE_REASONS`, `REPORT_REASONS`. **SMS** : le texte part dans la langue du DESTINATAIRE (`user.lang`, sinon français) : adapte `smsText(kind, locale)` et les appels dans `fake.ts` / `pg/data.ts` (blocs notifications), avec test de contrat (un destinataire `en` reçoit le SMS en anglais, un destinataire sans langue en français). Garde les SMS sans accents pour ln/sw si l'alphabet GSM l'exige (un caractère hors GSM double le coût : privilégie des formulations sans accents quand c'est naturel). |
| **O** | `errors`, `validation`, `prohibited`, `misc_o` | Tout le texte produit **côté serveur** : `src/lib/validation.ts`, `src/lib/schemas.ts`, les `AppError` de `src/lib/data/{fake.ts,pg/data.ts}`, `src/lib/{session,ratelimit,cart,photos,messaging,prohibited,phone}.ts`, `src/app/api/**`, `src/lib/http.ts`, `src/components/client/api.ts` (message réseau → `common.error_network`). **Conception imposée** (ne change pas les sites `throw new AppError("CODE", "texte français", 4xx)` : il y en a des centaines) : crée `src/i18n/server-messages.ts` avec `translateServerMessage(message, locale)` qui retrouve le texte français dans les espaces `errors` / `validation` / `prohibited` (table inverse « texte français → clé », construite une fois), accepte les textes à variables (`{n}` devient un motif qui capture la valeur, puis réinjecte dans la traduction) et renvoie le texte inchangé si inconnu (jamais d'erreur). Branche-le dans `handle()` (`src/lib/http.ts`, langue via `getLocale()`) pour `message` ET pour chaque valeur de `details`, et dans les erreurs de page. **Couverture à prouver** : un test qui parcourt TOUS les `AppError(…, "texte", …)` du code source (regex sur `src/`), et vérifie que chacun a une entrée française (liste des manquants = vide), plus un test de motif pour les textes à variables. Les règles d'articles interdits (`src/lib/prohibited.ts`) : le libellé et le message de chaque règle sont traduits par identifiant de règle (clés `prohibited.rule_<id>_label` / `_message`), sans jamais exposer de mots-clés. |

| **P** | `misc_p` (si besoin) | **Données de catégories** : traduis les noms de toutes les catégories en `en`, `ln`, `sw` (mêmes règles de qualité : laisse absent plutôt que faux). `Category.names` existe déjà (`src/lib/types.ts`), `categoryLabel()` aussi (`src/lib/categories.ts`). Seed (`src/lib/data/seed.ts`, `src/lib/data/pg/seed.ts` : la colonne `categories.name` est un jsonb `{ "fr": … }`, ajoute `en`/`ln`/`sw` dans le seed de RÉFÉRENCE ET par une migration `0013_category_names.sql` qui complète les lignes existantes sans écraser les modifications de l'équipe), lecture dans `listCategories` des deux couches (renvoie `names`), `categoryName` des fiches (ajoute `categoryNames`). **Tu ne modifies pas les écrans** (agents K à N appellent `categoryLabel`) ; vérifie seulement par un test de contrat deux couches que `names` est renvoyé, et par un e2e sur l'API. Ensuite, quand les autres branches seront fusionnées par le chef de projet, il te relancera pour brancher les derniers écrans si besoin. Port de test : 3126 / 5596. |

## Tests (obligatoires, par agent)
1. **Unitaires** : les tests de `src/i18n/__tests__/i18n.test.ts` doivent rester verts : tout `en` complet pour chaque clé `fr`, mêmes `{variables}`, toute clé littérale de `t("…")` existe. Ajoute des tests de ta logique (pluriels, formats).
2. **E2E** `e2e/specs/i18n-<lettre>.spec.ts` (helpers dans `e2e/i18n-helpers.ts` : `setLang`, `frenchLeftovers`) : pour chaque écran important de ta zone, ouvre-le avec `setLang(page, "en")`, vérifie quelques titres et libellés **en anglais**, vérifie `frenchLeftovers(page)` vide (en ignorant ce qui vient de données saisies), un parcours qui produit un message d'erreur (le texte d'erreur est dans la bonne langue), et un passage en `sw` (au moins un écran). **Axe** en anglais sur les écrans de ta zone (aucune violation grave). Aucune erreur d'hydratation (un test échoue sur toute erreur console). Pas de défilement horizontal à 320 px en anglais et en swahili (les textes sont plus longs : vérifie les boutons et les barres).
3. **Compteur de résidus** : `bash scripts/i18n-scan.sh <tes fichiers>` doit renvoyer **zéro ligne**, ou chaque ligne restante doit être justifiée dans ton rapport (nom propre, code, etc.).
4. `npm run i18n:report` : tes espaces à 100 % en `fr` et `en`, `ln`/`sw` selon la règle de qualité ci-dessus.

## Rapport final
Selon `replica/agent-brief.md`, plus : tableau de couverture de tes espaces (sortie de `npm run i18n:report`), liste des lignes restantes de `i18n-scan.sh` avec justification, clés `ln`/`sw` laissées volontairement absentes et pourquoi, fichiers hors zone que tu aurais voulu modifier, textes dont la traduction pose un problème de longueur ou de sens.
