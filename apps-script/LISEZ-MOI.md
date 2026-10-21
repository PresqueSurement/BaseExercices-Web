# Enregistrer les corrections (mots-clés, thème) dans la base

Le fichier `enregistrer-base.gs` est un script **Google Apps Script**. Il reçoit les corrections
envoyées par la page « Gérer la base » et les écrit dans `catalogue.json` sur GitHub, en un seul commit.
Il ne modifie que trois choses, pour les exercices envoyés : les mots-clés, le statut « vérifié » et le thème.
Le niveau, l'énoncé et les PDF ne sont jamais modifiés.

## Installation (une seule fois)

### 1. Créer une clé GitHub limitée à ce dépôt
1. Ouvrir <https://github.com/settings/personal-access-tokens/new>.
2. Nom : `Enregistrement mots-clés`. Durée : au choix (le script cessera de fonctionner à l'expiration).
3. **Repository access** : *Only select repositories* → `BaseExercices-Web`.
4. **Repository permissions** → **Contents** : *Read and write*.
5. Créer la clé et la copier tout de suite (elle commence par `github_pat_` et ne s'affiche qu'une fois).

### 2. Créer le script chez Google
1. Ouvrir <https://script.google.com> → *Nouveau projet*.
2. Remplacer tout le contenu de `Code.gs` par celui de `enregistrer-base.gs`, puis enregistrer.
3. Roue crantée *Paramètres du projet* → *Propriétés du script* → ajouter deux propriétés :
   - `MOT_DE_PASSE` : un mot de passe de votre choix (différent de ceux de Google et GitHub) ;
   - `JETON_GITHUB` : la clé copiée à l'étape 1.
4. Retour à l'éditeur : choisir la fonction `testerLaConfiguration` dans la liste, cliquer *Exécuter*,
   accepter les autorisations demandées, puis lire le *Journal d'exécution* : tout doit afficher « oui ».

### 3. Publier le script
1. *Déployer* → *Nouveau déploiement* → type *Application Web*.
2. *Exécuter en tant que* : **Moi**. *Qui a accès* : **Tout le monde**.
3. *Déployer*, puis copier l'**URL de l'application Web** (elle se termine par `/exec`).
4. Coller cette URL dans `enregistrement-config.json`, à la place des guillemets vides de `scriptUrl`.

## Utilisation
Dans la page, onglet *Gérer la base* : saisir le mot de passe, corriger les mots-clés, puis cliquer
*Enregistrer dans la base*. *Tester la connexion* vérifie tout sans rien écrire.
Le site se met à jour 1 à 2 minutes après l'enregistrement.

## Si le script change (version 2 : ajout du thème)
Le fichier `enregistrer-base.gs` du dépôt est la référence. Quand il change, il faut **recopier son contenu**
dans l'éditeur Apps Script (remplacer tout `Code.gs`), enregistrer, puis republier : *Déployer* → *Gérer les déploiements* →
crayon → *Version* : *Nouvelle version* → *Déployer*. L'URL ne change pas.

## Annuler un enregistrement
Chaque enregistrement est un commit visible dans l'historique du dépôt (`catalogue.json` → *History*).
Il suffit d'y rétablir la version précédente.
