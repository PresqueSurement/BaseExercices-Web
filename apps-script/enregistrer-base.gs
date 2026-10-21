/**
 * ENREGISTREMENT DES CORRECTIONS DANS LA BASE D'EXERCICES
 * ====================================================================
 *
 * Ce script tourne chez Google (Apps Script), pas sur GitHub.
 * La page « Gérer la base » lui envoie les corrections (mots-clés, thème) ;
 * il les range dans catalogue.json, sur GitHub, en UN SEUL commit.
 *
 * Ce que le script peut modifier : uniquement, pour chaque exercice envoyé,
 *   - la liste de ses mots-clés (parmi ceux qui existent déjà dans la base),
 *   - son statut « mots-clés vérifiés »,
 *   - son thème (un thème existant, ou un nouveau thème de 100 caractères au plus).
 * Tout le reste du catalogue (niveau, énoncé, PDF…) reste intact.
 *
 * Le numéro de version ci-dessous est renvoyé à la page, qui s'en sert pour
 * vérifier que le script publié chez Google est bien à jour.
 *
 * Deux informations secrètes sont à enregistrer dans
 * « Paramètres du projet » > « Propriétés du script » (jamais dans ce fichier) :
 *   MOT_DE_PASSE  : le mot de passe que vous tapez dans la page pour enregistrer.
 *   JETON_GITHUB  : la clé GitHub (limitée au dépôt BaseExercices-Web,
 *                   permission « Contents : Read and write »).
 */

// --- Réglages : le dépôt et le fichier à modifier ---
const DEPOT = {
  proprietaire: 'PresqueSurement',
  nom: 'BaseExercices-Web',
  branche: 'main',
  fichier: 'catalogue.json',
};
const VERSION_SCRIPT = 2;     // 1 = mots-clés seulement ; 2 = mots-clés + thème
const MAX_EXERCICES = 1500;   // nombre maximum d'exercices par envoi
const MAX_ECHECS = 10;        // mots de passe faux tolérés pendant 10 minutes


// =====================================================================
// Points d'entrée appelés par la page web
// =====================================================================

// Un simple test dans le navigateur : l'adresse du script répond « en ligne ».
function doGet() {
  return repondre({ ok: true, message: 'Le service d’enregistrement est en ligne.' });
}

// La page envoie ici les corrections (méthode POST).
function doPost(e) {
  const verrou = LockService.getScriptLock(); // évite deux enregistrements en même temps
  try {
    const demande = lireDemande(e);
    verifierMotDePasse(demande.motDePasse);
    const corrections = verifierCorrections(demande.corrections);
    const essai = demande.essai === true;   // essai = on vérifie tout, mais on n'écrit rien
    verrou.waitLock(30000);
    const resultat = appliquer(corrections, essai);
    return repondre(Object.assign({ ok: true, essai: essai }, resultat));
  } catch (erreur) {
    return repondre({ ok: false, erreur: erreur.message });
  } finally {
    try { verrou.releaseLock(); } catch (x) { /* rien à libérer */ }
  }
}


// =====================================================================
// À lancer à la main une fois, depuis l'éditeur Apps Script,
// pour vérifier que la clé GitHub et le mot de passe sont bien en place.
// Résultat à lire dans « Journal d'exécution ».
// =====================================================================
function testerLaConfiguration() {
  const proprietes = PropertiesService.getScriptProperties();
  Logger.log('Mot de passe enregistré : ' + (proprietes.getProperty('MOT_DE_PASSE') ? 'oui' : 'NON'));
  Logger.log('Clé GitHub enregistrée : ' + (proprietes.getProperty('JETON_GITHUB') ? 'oui' : 'NON'));
  const depot = JSON.parse(github('get', '').getContentText());
  Logger.log('Dépôt trouvé : ' + depot.full_name);
  Logger.log('Droit d’écriture avec cette clé : ' + (depot.permissions && depot.permissions.push ? 'oui' : 'NON'));
  const base = lireCatalogue();
  Logger.log('Catalogue lu : ' + base.exercices.length + ' exercices.');
}


// =====================================================================
// Vérification de la demande reçue
// =====================================================================

function lireDemande(e) {
  const texte = e && e.postData && e.postData.contents;
  if (!texte || texte.length > 1000000) throw new Error('Demande vide ou trop volumineuse.');
  let demande;
  try { demande = JSON.parse(texte); } catch (x) { throw new Error('Demande illisible.'); }
  if (!demande || demande.version !== 1 || demande.type !== 'atelier.corrections-mots-cles') {
    throw new Error('Format de demande inconnu.');
  }
  return demande;
}

function verifierMotDePasse(propose) {
  const cache = CacheService.getScriptCache();
  const echecs = Number(cache.get('echecs') || 0);
  if (echecs >= MAX_ECHECS) throw new Error('Trop d’essais incorrects. Réessayez dans 10 minutes.');
  const attendu = PropertiesService.getScriptProperties().getProperty('MOT_DE_PASSE');
  if (!attendu) throw new Error('Le mot de passe n’est pas enregistré dans le script.');
  if (typeof propose !== 'string' || !memeTexte(propose, attendu)) {
    cache.put('echecs', String(echecs + 1), 600);
    Utilities.sleep(1500); // ralentit les essais répétés
    throw new Error('Mot de passe incorrect.');
  }
}

// Comparaison de deux textes sans révéler, par le temps de réponse, où ils diffèrent.
function memeTexte(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

// Contrôle la forme des corrections et ne garde que les champs utiles.
function verifierCorrections(brutes) {
  if (!brutes || typeof brutes !== 'object' || Array.isArray(brutes)) throw new Error('Corrections invalides.');
  const ids = Object.keys(brutes);
  if (ids.length > MAX_EXERCICES) throw new Error('Trop d’exercices dans un seul envoi.');
  const propres = {};
  for (const id of ids) {
    const c = brutes[id];
    if (!/^[A-Z]\d{4}$/.test(id)) throw new Error('Identifiant d’exercice invalide : ' + id);
    if (!c || !Array.isArray(c.mots_cles) || c.mots_cles.length > 200 || typeof c.mots_cles_verifies !== 'boolean') {
      throw new Error('Correction invalide pour ' + id);
    }
    if (c.mots_cles.some(function (m) { return typeof m !== 'string' || m.length > 100; })) {
      throw new Error('Mot-clé invalide pour ' + id);
    }
    propres[id] = {
      mots_cles: Array.from(new Set(c.mots_cles)),
      mots_cles_verifies: c.mots_cles_verifies,
      // Thème : facultatif (undefined = on n'y touche pas).
      theme: c.theme === undefined || c.theme === null ? undefined : nettoyerTheme(c.theme, id),
      depart_theme: typeof c.original_theme === 'string' ? c.original_theme : null,
      // Les mots-clés que la page avait au départ : sert à repérer un écrasement.
      depart: Array.isArray(c.original_mots_cles)
        ? c.original_mots_cles.filter(function (m) { return typeof m === 'string'; }).slice(0, 200)
        : null,
    };
  }
  return propres;
}


// Un thème doit être un texte court, sans retour à la ligne ni caractère de contrôle.
function nettoyerTheme(valeur, id) {
  if (typeof valeur !== 'string') throw new Error('Thème invalide pour ' + id);
  const theme = valeur.replace(/\s+/g, ' ').trim();
  if (!theme || theme.length > 100 || /[\u0000-\u001f\u007f]/.test(theme)) {
    throw new Error('Thème invalide pour ' + id + ' (1 à 100 caractères).');
  }
  return theme;
}


// =====================================================================
// Application des corrections au catalogue
// =====================================================================

function appliquer(corrections, essai) {
  const base = lireCatalogue();
  const parId = {};
  const motsExistants = new Set();
  base.exercices.forEach(function (e) {
    parId[e.id] = e;
    e.mots_cles.forEach(function (m) { motsExistants.add(m); });
  });

  let texte = base.texte;  // le fichier tel qu'il est sur GitHub, modifié petit à petit
  const modifies = [];   // exercices réellement changés
  const ecrases = [];    // exercices dont le catalogue avait changé depuis le départ de la page
  Object.keys(corrections).forEach(function (id) {
    const exercice = parId[id];
    if (!exercice) throw new Error('Exercice absent de la base : ' + id);
    const c = corrections[id];
    c.mots_cles.forEach(function (m) {
      if (!motsExistants.has(m)) throw new Error('Mot-clé inconnu dans la base : ' + m);
    });
    const themeChange = c.theme !== undefined && c.theme !== exercice.theme;
    const dejaAJour = memeListe(c.mots_cles, exercice.mots_cles)
      && c.mots_cles_verifies === (exercice.mots_cles_verifies === true)
      && !themeChange;
    if (dejaAJour) return;
    const motsChanges = c.depart && !memeListe(c.depart, exercice.mots_cles);
    const themeChangeAilleurs = c.depart_theme !== null && c.depart_theme !== exercice.theme;
    if (motsChanges || themeChangeAilleurs) ecrases.push(id);
    modifies.push({
      id: id,
      avant: exercice.mots_cles,
      apres: c.mots_cles,
      verifie_avant: exercice.mots_cles_verifies === true,
      verifie_apres: c.mots_cles_verifies,
      theme_avant: exercice.theme,
      theme_apres: themeChange ? c.theme : exercice.theme,
    });
    if (!essai) texte = modifierTexte(texte, id, c.mots_cles, c.mots_cles_verifies, themeChange ? c.theme : undefined);
  });

  const ids = modifies.map(function (m) { return m.id; });
  if (!modifies.length) {
    return { modifies: 0, ids: [], ecrases: [], message: 'Rien à enregistrer : la base est déjà à jour.' };
  }
  if (essai) {
    return { modifies: modifies.length, ids: ids, ecrases: ecrases, details: modifies.slice(0, 20) };
  }

  const themes = modifies.filter(function (m) { return m.theme_avant !== m.theme_apres; });
  const message = 'Corrections : ' + modifies.length + ' exercice' + (modifies.length > 1 ? 's' : '')
    + '\n\nExercices : ' + ids.slice(0, 40).join(', ') + (ids.length > 40 ? ', …' : '')
    + (themes.length
      ? '\n\nThèmes modifiés :\n' + themes.slice(0, 20).map(function (m) {
          return '- ' + m.id + ' : ' + m.theme_avant + ' → ' + m.theme_apres;
        }).join('\n') + (themes.length > 20 ? '\n- …' : '')
      : '')
    + '\n\nEnregistré depuis la page « Gérer la base ».';
  verifierResultat(texte, base.exercices, corrections);
  const commit = ecrireCatalogue(base, texte, message);
  return {
    modifies: modifies.length,
    ids: ids,
    ecrases: ecrases,
    commit: commit.sha.slice(0, 7),
    commit_url: commit.html_url,
  };
}

function memeListe(a, b) {
  return JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
}

// Remplace, dans le texte du fichier, les mots-clés, le statut « vérifié » et (si demandé)
// le thème d'UN exercice. On ne réécrit pas tout le fichier : le reste n'est pas touché.
function modifierTexte(texte, id, motsCles, verifie, theme) {
  const marque = '{"id": ' + JSON.stringify(id) + ',';
  const debut = texte.indexOf(marque);
  if (debut < 0) throw new Error('Exercice introuvable dans le fichier : ' + id);
  const suivant = texte.indexOf('{"id": ', debut + 1);     // début de l'exercice d'après
  const limite = suivant < 0 ? texte.length : suivant;

  const cleTheme = '"theme": ';
  const cleListe = '"mots_cles": [';
  const t = texte.indexOf(cleTheme, debut);
  const a = texte.indexOf(cleListe, debut);
  const b = a < 0 ? -1 : texte.indexOf(']', a);
  const cleVerifie = '"mots_cles_verifies": ';
  const c = b < 0 ? -1 : texte.indexOf(cleVerifie, b);
  if (t < 0 || a < 0 || b < 0 || c < 0 || t > a || b > limite || c > limite) {
    throw new Error('Structure inattendue pour ' + id + ' : enregistrement annulé.');
  }
  const debutValeur = c + cleVerifie.length;
  const ancienneValeur = texte.startsWith('true', debutValeur) ? 'true' : (texte.startsWith('false', debutValeur) ? 'false' : '');
  if (!ancienneValeur) throw new Error('Structure inattendue pour ' + id + ' : enregistrement annulé.');

  const nouvelleListe = '[' + motsCles.map(function (m) { return JSON.stringify(m); }).join(', ') + ']';
  // On modifie d'abord la fin (le statut), puis la liste, puis le thème (le plus tôt dans le texte),
  // pour ne jamais décaler les positions encore à traiter.
  let resultat = texte.slice(0, debutValeur) + String(verifie) + texte.slice(debutValeur + ancienneValeur.length);
  resultat = resultat.slice(0, a + cleListe.length - 1) + nouvelleListe + resultat.slice(b + 1);
  if (theme !== undefined) {
    const debutTheme = t + cleTheme.length;
    const finTheme = a - 2;                                  // le thème se termine avant « , »
    if (resultat.slice(finTheme, a) !== ', ' || resultat.charAt(debutTheme) !== '"' || resultat.charAt(finTheme - 1) !== '"') {
      throw new Error('Structure inattendue pour ' + id + ' : enregistrement annulé.');
    }
    resultat = resultat.slice(0, debutTheme) + JSON.stringify(theme) + resultat.slice(finTheme);
  }
  return resultat;
}

// Dernière vérification avant d'écrire : le fichier doit rester du JSON valide,
// avec le même nombre d'exercices, et les corrections doivent y figurer.
function verifierResultat(texte, anciens, corrections) {
  const nouveaux = JSON.parse(texte);
  if (nouveaux.length !== anciens.length) throw new Error('Contrôle final : le nombre d’exercices a changé. Enregistrement annulé.');
  nouveaux.forEach(function (e, i) {
    if (e.id !== anciens[i].id) throw new Error('Contrôle final : l’ordre des exercices a changé. Enregistrement annulé.');
    const c = corrections[e.id];
    const attendu = c ? c.mots_cles : anciens[i].mots_cles;
    const verifie = c ? c.mots_cles_verifies : anciens[i].mots_cles_verifies === true;
    const themeAttendu = c && c.theme !== undefined ? c.theme : anciens[i].theme;
    if (!memeListe(e.mots_cles, attendu) || (e.mots_cles_verifies === true) !== verifie || e.theme !== themeAttendu) {
      throw new Error('Contrôle final : résultat inattendu pour ' + e.id + '. Enregistrement annulé.');
    }
  });
}


// =====================================================================
// Dialogue avec GitHub
// (on passe par l'API « Git Data », qui accepte les gros fichiers :
//  catalogue.json fait environ 2,5 Mo)
// =====================================================================

// Lit le dernier état de la branche et le contenu de catalogue.json.
function lireCatalogue() {
  const reference = JSON.parse(github('get', '/git/ref/heads/' + DEPOT.branche).getContentText());
  const commitSha = reference.object.sha;
  const commit = JSON.parse(github('get', '/git/commits/' + commitSha).getContentText());
  const arbre = JSON.parse(github('get', '/git/trees/' + commit.tree.sha).getContentText());
  const entree = arbre.tree.filter(function (x) { return x.path === DEPOT.fichier && x.type === 'blob'; })[0];
  if (!entree) throw new Error(DEPOT.fichier + ' est introuvable dans le dépôt.');
  const texte = github('get', '/git/blobs/' + entree.sha, null, 'application/vnd.github.raw+json')
    .getContentText('UTF-8');
  return {
    commitSha: commitSha,
    arbreSha: commit.tree.sha,
    texte: texte,
    exercices: JSON.parse(texte),
  };
}

// Crée le nouveau fichier, l'arbre, le commit, puis avance la branche.
// Si quelqu'un a modifié la branche entre-temps, GitHub refuse : rien n'est écrasé.
function ecrireCatalogue(base, contenu, message) {
  const blob = JSON.parse(github('post', '/git/blobs', { content: contenu, encoding: 'utf-8' }).getContentText());
  const arbre = JSON.parse(github('post', '/git/trees', {
    base_tree: base.arbreSha,
    tree: [{ path: DEPOT.fichier, mode: '100644', type: 'blob', sha: blob.sha }],
  }).getContentText());
  const commit = JSON.parse(github('post', '/git/commits', {
    message: message,
    tree: arbre.sha,
    parents: [base.commitSha],
  }).getContentText());
  github('patch', '/git/refs/heads/' + DEPOT.branche, { sha: commit.sha, force: false });
  return commit;
}

// Envoie une requête à l'API GitHub avec la clé enregistrée dans le script.
function github(methode, chemin, charge, accept) {
  const jeton = PropertiesService.getScriptProperties().getProperty('JETON_GITHUB');
  if (!jeton) throw new Error('La clé GitHub n’est pas enregistrée dans le script.');
  const options = {
    method: methode,
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + jeton,
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  if (charge) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(charge);
  }
  const url = 'https://api.github.com/repos/' + DEPOT.proprietaire + '/' + DEPOT.nom + chemin;
  const reponse = UrlFetchApp.fetch(url, options);
  const code = reponse.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(expliquerErreur(code, methode));
  return reponse;
}

function expliquerErreur(code, methode) {
  if (code === 401) return 'La clé GitHub est invalide ou a expiré.';
  if (code === 403 || code === 404) {
    return 'GitHub refuse l’accès : la clé doit être limitée au dépôt ' + DEPOT.nom
      + ' avec la permission « Contents : Read and write ».';
  }
  if (code === 409 || (code === 422 && methode === 'patch')) {
    return 'La base a été modifiée pendant l’enregistrement. Réessayez dans un instant.';
  }
  return 'GitHub a répondu par une erreur (code ' + code + ').';
}

function repondre(objet) {
  objet.schema = VERSION_SCRIPT;
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}
