import {normalize, levels} from './core.mjs';

export const MANAGEMENT_STORAGE = 'atelier.corrections-mots-cles.v1';
export const CORRECTIONS_TYPE = 'atelier.corrections-mots-cles';
export const SAVE_CONFIG = 'enregistrement-config.json';
const PASSWORD_STORAGE = 'atelier.base.motdepasse.v1';
const NEW_THEME = '__nouveau_theme__';
const isKeyword = key => typeof key === 'string' && key.length <= 60 && /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(key);
const keywordSlug = text => normalize(text).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const sameKeywords = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const sameState = (value, original) => sameKeywords(value.mots_cles, original.mots_cles)
  && value.mots_cles_verifies === original.mots_cles_verifies && value.theme === original.theme;
const cleanTheme = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const validTheme = text => typeof text === 'string' && text === cleanTheme(text) && text.length > 0 && text.length <= 100 && !/[\u0000-\u001f\u007f]/.test(text);

export function validateCorrections(data, available) {
  if (!data || data.version !== 1 || data.type !== CORRECTIONS_TYPE || !data.corrections || Array.isArray(data.corrections) || typeof data.corrections !== 'object') throw new Error('Sauvegarde de corrections incompatible.');
  const result = Object.create(null);
  for (const [id, entry] of Object.entries(data.corrections)) {
    if (!available.has(id)) {if (entry?.supprime === true) continue; throw new Error('Exercice absent de cette base : ' + id);}   // suppression déjà publiée : on l'oublie
    if (!entry || !Array.isArray(entry.mots_cles) || entry.mots_cles.length > 200 || entry.mots_cles.some(key => !isKeyword(key)) || typeof entry.mots_cles_verifies !== 'boolean') throw new Error('Correction invalide pour ' + id);
    const original = entry.original_mots_cles;
    if (original !== undefined && (!Array.isArray(original) || original.length > 200 || original.some(key => typeof key !== 'string' || key.length > 100))) throw new Error('Historique invalide pour ' + id);
    if (entry.supprime !== undefined && typeof entry.supprime !== 'boolean') throw new Error('Correction invalide pour ' + id);
    if (entry.theme !== undefined && !validTheme(entry.theme)) throw new Error('Thème invalide pour ' + id);
    if (entry.original_theme !== undefined && !validTheme(entry.original_theme)) throw new Error('Thème d’origine invalide pour ' + id);
    result[id] = {mots_cles: [...new Set(entry.mots_cles)], mots_cles_verifies: entry.mots_cles_verifies,
      theme: entry.theme ?? available.get(id).theme,
      original_mots_cles: [...(original || available.get(id).mots_cles)],
      original_theme: entry.original_theme ?? available.get(id).theme, ...(entry.supprime === true ? {supprime: true} : {})};
  }
  return result;
}

export function correctionsFile(corrections) {
  return {version: 1, type: CORRECTIONS_TYPE, exportedAt: new Date().toISOString(), corrections};
}

export function attachManagement(exercises, onChange, toast) {
  const $ = id => document.getElementById(id);
  const byId = new Map(exercises.map(e => [e.id, e]));
  const originals = new Map(exercises.map(e => [e.id, {mots_cles: [...e.mots_cles], mots_cles_verifies: e.mots_cles_verifies === true, theme: e.theme}]));
  const baseKeys = new Set([...originals.values()].flatMap(o => o.mots_cles));   // mots-clés déjà présents dans la base publiée
  const extraKeywords = new Set();                                              // mots-clés créés pendant cette session
  const allKeywords = () => [...new Set([...baseKeys, ...extraKeywords, ...exercises.flatMap(e => e.mots_cles)])].sort((a, b) => a.localeCompare(b, 'fr'));
  let corrections = Object.create(null), currentId = null, list = [], page = 0;
  const SIZE = 20;
  const status = text => {$('manage-storage-status').textContent = text;};
  try {
    const raw = localStorage.getItem(MANAGEMENT_STORAGE);
    if (raw) corrections = validateCorrections(JSON.parse(raw), byId);
  } catch {status('La sauvegarde locale des corrections est illisible : elle a été ignorée.');}

  // Une correction déjà publiée dans le catalogue n'a plus de raison d'être gardée dans ce navigateur.
  const beforePruning = Object.keys(corrections).length;
  for (const id of Object.keys(corrections)) {
    const value = corrections[id], original = originals.get(id);
    if (!value.supprime && sameState(value, original)) delete corrections[id];
  }
  if (Object.keys(corrections).length !== beforePruning) {
    try {localStorage.setItem(MANAGEMENT_STORAGE, JSON.stringify(correctionsFile(corrections)));} catch {}
  }

  // Corrections déjà envoyées à la base (le site n'est pas encore republié) : elles ne sont plus « en attente ».
  const SAVED_STORAGE = 'atelier.base.enregistre.v1';
  const signature = c => JSON.stringify({m: [...c.mots_cles].sort(), v: c.mots_cles_verifies, t: c.theme, s: !!c.supprime});
  let saved = {};
  try {saved = JSON.parse(localStorage.getItem(SAVED_STORAGE)) || {};} catch {}
  const pendingIds = () => {for (const id of Object.keys(saved)) if (!corrections[id]) delete saved[id]; return Object.keys(corrections).filter(id => saved[id] !== signature(corrections[id])).sort();};
  function rememberSaved(ids) {
    for (const id of ids) saved[id] = signature(corrections[id]);
    for (const id of Object.keys(saved)) if (!corrections[id]) delete saved[id];
    try {localStorage.setItem(SAVED_STORAGE, JSON.stringify(saved));} catch {}
  }

  // --- Enregistrement dans la base (script Google -> catalogue.json sur GitHub) ---
  let saveUrl = '', saving = false;
  const count = n => n + ' exercice' + (n > 1 ? 's' : '');
  const names = ids => ids.slice(0, 8).join(', ') + (ids.length > 8 ? '…' : '');
  function refreshSave() {
    const configured = !!saveUrl;
    const pending = pendingIds().length;
    $('manage-save').disabled = saving || !configured || !pending;
    $('manage-save').textContent = pending ? `Enregistrer dans la base (${pending})` : 'Enregistrer dans la base';
    $('manage-test').disabled = saving || !configured;
    $('manage-save-note').hidden = configured;
  }
  function describeResult(data) {
    const total = data.modifies || 0, gone = data.supprimes?.length || 0;
    const fresh = data.nouveaux_mots_cles || [];
    const created = fresh.length ? ` ${data.essai ? 'Il créerait' : 'Créé'} ${fresh.length} nouveau${fresh.length > 1 ? 'x' : ''} mot${fresh.length > 1 ? 's' : ''}-clé${fresh.length > 1 ? 's' : ''} : ${fresh.join(', ')}.` : '';
    const removed = data.supprimes?.length ? ` ${data.essai ? 'Il supprimerait' : 'Supprimé'} ${count(data.supprimes.length)} (${names(data.supprimes)}) avec ${data.fichiers_supprimes || 0} fichier${data.fichiers_supprimes > 1 ? 's' : ''} (PDF, aperçus, images).` : '';
    const warning = data.ecrases?.length
      ? ` Attention : ${count(data.ecrases.length)} (${names(data.ecrases)}) avaient été modifiés ailleurs depuis ; vos corrections ${data.essai ? 'les remplaceraient' : 'les ont remplacés'}.` : '';
    if (!total && gone) return (data.essai ? 'Connexion réussie.' : 'Enregistré.') + removed + (data.essai ? ' Rien n’a été écrit.' : ' Le site se met à jour dans 1 à 2 minutes ; rechargez ensuite la page.');
    if (!total) return data.essai ? 'Connexion réussie. Rien à enregistrer pour le moment.' : (data.message || 'Rien à enregistrer : la base est déjà à jour.');
    if (data.essai) return `Connexion réussie. L’enregistrement modifierait ${count(total)} (${names(data.ids)}). Rien n’a été écrit.${created}${removed}${warning}`;
    return `Enregistré : ${count(total)} (${names(data.ids)}), commit ${data.commit}. Le site se met à jour dans 1 à 2 minutes ; rechargez ensuite la page.${created}${removed}${warning}`;
  }
  function rememberPassword(password) {
    try {
      if ($('manage-remember').checked) localStorage.setItem(PASSWORD_STORAGE, password);
      else localStorage.removeItem(PASSWORD_STORAGE);
    } catch {}
  }
  async function sendToBase(dryRun) {
    if (saving || !saveUrl) return;
    const password = $('manage-password').value;
    if (!password) {status('Saisissez d’abord le mot de passe d’enregistrement.'); $('manage-password').focus(); return;}
    const ids = pendingIds(), sent = Object.fromEntries(ids.map(id => [id, corrections[id]]));
    const deletions = Object.values(sent).filter(c => c.supprime).length;
    const themeChanges = Object.values(sent).filter(c => !c.supprime && c.theme !== c.original_theme).length;
    const newKeywords = [...new Set(Object.values(sent).filter(c => !c.supprime).flatMap(c => c.mots_cles))].filter(key => !baseKeys.has(key));
    saving = true; refreshSave();
    status(dryRun ? 'Test de la connexion avec la base…' : `Enregistrement de ${count(ids.length)} dans la base…`);
    try {
      const response = await fetch(saveUrl, {
        method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, credentials: 'omit', redirect: 'follow', cache: 'no-store',
        body: JSON.stringify({...correctionsFile(sent), motDePasse: password, essai: dryRun}), signal: AbortSignal.timeout(120000),
      });
      let data;
      try {data = await response.json();} catch {throw new Error('Le service d’enregistrement n’a pas répondu comme prévu. Vérifiez que le script Google est déployé avec l’accès « Tout le monde ».');}
      if (!data.ok && /Mot-clé inconnu/.test(data.erreur || '')) throw new Error('Le script Google n’est pas à jour : il refuse les nouveaux mots-clés. Republiez-le avec la dernière version (voir apps-script/LISEZ-MOI.md) ; vos corrections restent gardées dans ce navigateur.');
      if (!data.ok) throw new Error(data.erreur || 'Échec de l’enregistrement.');
      rememberPassword(password);
      if (!dryRun && (data.schema || 1) >= 4) rememberSaved(ids);
      const missing = [];
      if (themeChanges && (data.schema || 1) < 2) missing.push('les changements de thème');
      if (newKeywords.length && (data.schema || 1) < 3) missing.push('les nouveaux mots-clés');
      if (deletions && (data.schema || 1) < 4) missing.push('les suppressions d’exercices');
      const outdated = missing.length
        ? ` ⚠ Le script Google n’est pas à jour : il ne peut pas enregistrer ${missing.join(' ni ')}. Republiez-le avec la dernière version (voir apps-script/LISEZ-MOI.md) ; vos changements restent gardés dans ce navigateur.` : '';
      status(describeResult(data) + outdated);
      if (!dryRun && (data.modifies || data.supprimes?.length)) toast('Corrections enregistrées dans la base.');
    } catch (error) {
      status(['TimeoutError', 'AbortError'].includes(error.name) ? 'Le service met trop de temps à répondre. Réessayez dans un instant.'
        : error instanceof TypeError ? 'Impossible de joindre le service d’enregistrement. Vérifiez votre connexion.' : 'Échec : ' + error.message);
    } finally {saving = false; renderSummary(); refreshSave();}
  }

  function apply() {
    for (const e of exercises) {
      const value = corrections[e.id] || originals.get(e.id);
      e.mots_cles = [...value.mots_cles]; e.mots_cles_verifies = value.mots_cles_verifies; e.theme = value.theme; e.supprime = !!value.supprime;
    }
  }
  function persist() {
    apply();
    try {localStorage.setItem(MANAGEMENT_STORAGE, JSON.stringify(correctionsFile(corrections))); status('');}
    catch {status('Le navigateur n’a pas pu garder les corrections. Elles sont en mémoire : enregistrez-les dans la base maintenant.');}
    refreshThemeFilter(); onChange(); renderList(); renderEditor();
  }
  // changes : une partie de {mots_cles, mots_cles_verifies, theme} ; le reste garde sa valeur actuelle.
  function update(changes) {
    const e = byId.get(currentId), original = originals.get(currentId);
    if (!e || corrections[currentId]?.supprime) return;     // un exercice à supprimer n'est plus modifiable
    const next = {mots_cles: [...e.mots_cles], mots_cles_verifies: e.mots_cles_verifies === true, theme: e.theme, ...changes};
    next.mots_cles = [...next.mots_cles];
    if (sameState(next, original)) delete corrections[currentId];
    else corrections[currentId] = {...next,
      original_mots_cles: corrections[currentId]?.original_mots_cles || [...original.mots_cles],
      original_theme: corrections[currentId]?.original_theme || original.theme};
    persist();
  }
  const allThemes = () => [...new Set(exercises.map(e => e.theme))].sort((a, b) => a.localeCompare(b, 'fr'));
  function refreshThemeFilter() {
    const select = $('manage-theme'), current = select.value, themes = allThemes();
    select.replaceChildren(new Option('Tous les thèmes', ''), ...themes.map(theme => new Option(theme, theme)));
    select.value = themes.includes(current) ? current : '';
  }
  function renderThemeMenu(e) {
    const select = $('manage-exercise-theme');
    const sameLevel = [...new Set(exercises.filter(x => x.niveau === e.niveau).map(x => x.theme))].sort((a, b) => a.localeCompare(b, 'fr'));
    const others = allThemes().filter(theme => !sameLevel.includes(theme));
    const group = (label, themes) => {const g = document.createElement('optgroup'); g.label = label; g.append(...themes.map(theme => new Option(theme, theme))); return g;};
    select.replaceChildren(group('Thèmes de ' + levels[e.niveau].toLowerCase(), sameLevel), ...(others.length ? [group('Autres thèmes', others)] : []), new Option('➕ Nouveau thème…', NEW_THEME));
    select.value = e.theme;
    $('manage-new-theme-box').hidden = true;
  }
  function applyNewTheme() {
    const e = byId.get(currentId); if (!e) return;
    const name = cleanTheme($('manage-new-theme').value);
    if (!name) {toast('Saisissez le nom du nouveau thème.'); return;}
    if (!validTheme(name)) {toast('Nom de thème invalide : 100 caractères au plus, sans caractère spécial.'); return;}
    const existing = allThemes().find(theme => normalize(theme) === normalize(name));
    $('manage-new-theme').value = '';
    if (existing) toast(`Le thème « ${existing} » existe déjà : il a été utilisé.`);
    if ((existing || name) !== e.theme) update({theme: existing || name}); else renderEditor();
  }
  const kw = key => key.replaceAll('_', ' ');
  const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);
  function renderSummary() {
    const ids = pendingIds(), rows = [];
    let verified = 0, unverified = 0, kwExercises = 0, added = 0, removed = 0;
    const themes = [], doomed = [], fresh = new Set();
    for (const id of ids) {
      const c = corrections[id], o = originals.get(id), row = {id, parts: [], danger: false};
      if (c.supprime) {doomed.push(id); row.parts.push('🗑 sera supprimé'); row.danger = true; rows.push(row); continue;}
      const plus = c.mots_cles.filter(k => !o.mots_cles.includes(k)), minus = o.mots_cles.filter(k => !c.mots_cles.includes(k));
      if (plus.length || minus.length) {kwExercises++; added += plus.length; removed += minus.length; row.parts.push('mots-clés : ' + [...plus.map(k => '+' + kw(k)), ...minus.map(k => '−' + kw(k))].join(' '));}
      plus.filter(k => !baseKeys.has(k)).forEach(k => fresh.add(k));
      if (c.theme !== o.theme) {themes.push(id); row.parts.push(`thème : ${o.theme} → ${c.theme}`);}
      if (c.mots_cles_verifies && !o.mots_cles_verifies) {verified++; row.parts.push('✓ vérifié');}
      if (!c.mots_cles_verifies && o.mots_cles_verifies) {unverified++; row.parts.push('repasse « à vérifier »');}
      rows.push(row);
    }
    const kept = new Set(exercises.filter(e => !e.supprime).flatMap(e => [e.pdf, ...(e.previews || []).map(v => v.src), ...Object.values(e.images || {})]));
    const files = new Set(doomed.flatMap(id => { const e = byId.get(id); return [e.pdf, ...(e.previews || []).map(v => v.src), ...Object.values(e.images || {})]; }).filter(f => f && !kept.has(f)));
    const lines = [];
    if (verified) lines.push(['✓', `${plural(verified, 'exercice marqué', 'exercices marqués')} « vérifié${verified > 1 ? 's' : ''} »`]);
    if (unverified) lines.push(['↺', `${plural(unverified, 'exercice repassé', 'exercices repassés')} « à vérifier »`]);
    if (kwExercises) lines.push(['🏷', `${plural(kwExercises, 'exercice avec mots-clés modifiés', 'exercices avec mots-clés modifiés')} (+${added} ajouté${added > 1 ? 's' : ''}, −${removed} retiré${removed > 1 ? 's' : ''})`]);
    if (fresh.size) lines.push(['➕', `${plural(fresh.size, 'nouveau mot-clé créé', 'nouveaux mots-clés créés')} : ${[...fresh].sort().map(kw).join(', ')}`]);
    if (themes.length) lines.push(['📁', `${plural(themes.length, 'changement de thème', 'changements de thème')} : ${names(themes)}`]);
    if (doomed.length) lines.push(['🗑', `${plural(doomed.length, 'exercice à supprimer', 'exercices à supprimer')} : ${names(doomed)} (${plural(files.size, 'fichier effacé', 'fichiers effacés')})`, true]);
    $('manage-summary-count').textContent = ids.length ? `${count(ids.length)} touché${ids.length > 1 ? 's' : ''}` : 'Aucun changement en attente : la base est à jour.';
    $('manage-summary').replaceChildren(...lines.map(([icon, text, danger]) => {
      const li = document.createElement('li'); if (danger) li.className = 'is-danger';
      const span = document.createElement('span'); span.className = 'icon'; span.textContent = icon; li.append(span, text); return li;
    }));
    $('manage-summary-details').hidden = !rows.length;
    $('manage-summary-list').replaceChildren(...rows.map(row => {
      const li = document.createElement('li'), button = document.createElement('button'), id = document.createElement('b');
      button.type = 'button'; if (row.danger) button.className = 'is-danger'; id.textContent = row.id;
      button.append(id, row.parts.join(' · ') || 'modifié'); button.title = 'Ouvrir cet exercice'; button.onclick = () => openExercise(row.id);
      li.append(button); return li;
    }));
  }
  function openExercise(id) {
    const e = byId.get(id); if (!e) return;
    $('manage-query').value = ''; $('manage-theme').value = ''; $('manage-state').value = ''; $('manage-level').value = e.niveau;
    currentId = id; renderList(); page = Math.floor(Math.max(0, list.findIndex(x => x.id === id)) / SIZE);
    $('manage-keyword-search').value = ''; renderList(); renderEditor();
    $('manage-editor').scrollIntoView({behavior: 'smooth', block: 'start'});
  }
  function renderList() {
    const query = normalize($('manage-query').value).trim().split(/\s+/).filter(Boolean);
    const mode = $('manage-state').value;
    list = exercises.filter(e => (!$('manage-level').value || e.niveau === $('manage-level').value)
      && (!$('manage-theme').value || e.theme === $('manage-theme').value)
      && (mode !== 'verified' || e.mots_cles_verifies) && (mode !== 'unchecked' || !e.mots_cles_verifies)
      && (mode !== 'changed' || corrections[e.id])
      && query.every(word => normalize([e.id, e.theme, ...e.mots_cles, e.text].join(' ')).includes(word)))
      .sort((a, b) => a.id.localeCompare(b.id));
    page = Math.max(0, Math.min(page, Math.ceil(list.length / SIZE) - 1));
    $('manage-list-count').textContent = `${list.length} exercice${list.length > 1 ? 's' : ''}`;
    $('manage-list').replaceChildren(...list.slice(page * SIZE, (page + 1) * SIZE).map(e => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'manage-list-item' + (currentId === e.id ? ' active' : '');
      button.setAttribute('aria-pressed', String(currentId === e.id));
      const title = document.createElement('strong'); title.textContent = e.id + ' · ' + e.theme.replaceAll('_', ' ');
      const info = document.createElement('span'); info.textContent = `${levels[e.niveau]} · ${e.mots_cles.length} mots-clés · ${e.mots_cles_verifies ? '✓ Vérifié' : 'À vérifier'}${corrections[e.id]?.supprime ? ' · 🗑 sera supprimé' : corrections[e.id] ? ' · modifié ici' : ''}`;
      if (corrections[e.id]?.supprime) button.classList.add('is-deleted');
      button.append(title, info); button.onclick = () => {currentId = e.id; $('manage-keyword-search').value = ''; renderList(); renderEditor();}; return button;
    }));
    if (!list.length) $('manage-list').textContent = 'Aucun exercice pour ces filtres.';
    $('manage-list-page').textContent = `${page + 1} / ${Math.max(1, Math.ceil(list.length / SIZE))}`;
    $('manage-list-prev').disabled = !page; $('manage-list-next').disabled = (page + 1) * SIZE >= list.length;
    const verified = exercises.filter(e => e.mots_cles_verifies).length;
    const changed = Object.keys(corrections).length;
    $('manage-progress').textContent = `${verified} / ${exercises.length} vérifiés · ${changed} exercice${changed > 1 ? 's' : ''} avec une correction locale`;
    renderSummary(); refreshSave();
  }
  function createKeyword() {
    const e = byId.get(currentId); if (!e) return;
    const name = keywordSlug($('manage-keyword-search').value);
    if (!isKeyword(name)) {toast('Nom de mot-clé invalide (60 caractères au plus).'); return;}
    extraKeywords.add(name);
    $('manage-keyword-search').value = '';
    if (e.mots_cles.includes(name)) renderKeywords();
    else update({mots_cles: [...e.mots_cles, name], mots_cles_verifies: false});
    toast(`Mot-clé « ${name} » créé et ajouté à ${e.id}.`);
  }
  function renderKeywords() {
    const e = byId.get(currentId); if (!e) return;
    const query = normalize($('manage-keyword-search').value).trim();
    const makeChip = (key, removeOnly = false) => {
      const selected = e.mots_cles.includes(key), button = document.createElement('button');
      button.type = 'button'; button.className = 'keyword-chip' + (selected ? ' is-selected' : '');
      button.textContent = (selected ? '✓ ' : '+ ') + key.replaceAll('_', ' ') + (removeOnly ? ' ×' : '');
      button.setAttribute('aria-label', (removeOnly ? 'Retirer le mot-clé ' : '') + key.replaceAll('_', ' '));
      button.dataset.keyword = key;
      if (!removeOnly) button.setAttribute('aria-pressed', String(selected));
      button.onclick = () => {
        update({mots_cles: selected ? e.mots_cles.filter(k => k !== key) : [...e.mots_cles, key], mots_cles_verifies: false});
        const target = [...$('manage-keywords').querySelectorAll('button')].find(b => b.dataset.keyword === key) || $('manage-keyword-search');
        target.focus({preventScroll: true});
      };
      return button;
    };
    $('manage-current-keywords').replaceChildren(...e.mots_cles.map(key => makeChip(key, true)));
    if (!e.mots_cles.length) $('manage-current-keywords').textContent = 'Aucun mot-clé attribué.';
    const keys = allKeywords();
    const visible = keys.filter(key => normalize(key.replaceAll('_', ' ')).includes(query));
    $('manage-keywords').replaceChildren(...visible.map(key => makeChip(key)));
    const wanted = keywordSlug($('manage-keyword-search').value);
    const canCreate = isKeyword(wanted) && !keys.includes(wanted);
    $('manage-create-keyword').hidden = !canCreate;
    if (canCreate) $('manage-create-keyword-button').textContent = `➕ Créer le mot-clé « ${wanted.replaceAll('_', ' ')} » et l’ajouter à cet exercice`;
    $('manage-no-keywords').hidden = !!visible.length || canCreate;
  }
  function renderEditor() {
    const e = byId.get(currentId);
    $('manage-editor').hidden = !e; $('manage-empty').hidden = !!e;
    if (!e) return;
    $('manage-exercise-heading').textContent = `${e.id} · ${e.theme.replaceAll('_', ' ')}`;
    $('manage-exercise-info').textContent = `${levels[e.niveau]}${e.source ? ' · Source : ' + e.source : ''}`;
    renderThemeMenu(e);
    $('manage-verified').checked = !!e.mots_cles_verifies;
    $('manage-current-state').textContent = e.mots_cles_verifies ? '✓ Mots-clés vérifiés' : 'Mots-clés à vérifier';
    $('manage-reset').disabled = !corrections[e.id];
    const doomed = !!corrections[e.id]?.supprime;
    $('manage-delete-notice').hidden = !doomed; $('manage-delete').hidden = doomed;
    for (const id of ['manage-exercise-theme', 'manage-verified', 'manage-keyword-search', 'manage-verify-next']) $(id).disabled = doomed;
    $('manage-editor').classList.toggle('is-deleted', doomed);
    $('manage-open-pdf').href = e.pdf;
    // Garder l'aperçu et sa position lorsque l'on coche simplement un mot-clé.
    if ($('manage-pdf-pages').dataset.exercise !== e.id) {
      $('manage-pdf-pages').dataset.exercise = e.id;
      $('manage-pdf-pages').replaceChildren(...(e.previews || []).map((view, index) => {
        const image = document.createElement('img'); image.src = view.src; image.alt = `Énoncé PDF ${e.id}, page ${index + 1}`;
        image.width = view.width; image.height = view.height; image.decoding = 'async'; return image;
      }));
      $('manage-pdf-pages').scrollTop = 0;
    }
    renderKeywords();
  }
  function nextExercise(verify = false) {
    const index = list.findIndex(e => e.id === currentId), next = list[index + 1];
    if (verify && currentId) update({mots_cles_verifies: true});
    if (next) {currentId = next.id; page = Math.floor(Math.max(0, list.findIndex(e => e.id === currentId)) / SIZE); $('manage-keyword-search').value = ''; renderList(); renderEditor();}
    else toast('Vous êtes au dernier exercice de cette liste.');
  }
  for (const id of ['manage-query', 'manage-level', 'manage-theme', 'manage-state']) $(id).addEventListener(id === 'manage-query' ? 'input' : 'change', () => {page = 0; renderList(); if (!list.some(e => e.id === currentId)) {currentId = list[0]?.id || null; renderList(); renderEditor();}});
  $('manage-keyword-search').oninput = renderKeywords;
  $('manage-create-keyword-button').onclick = createKeyword;
  $('manage-verified').onchange = () => {if (currentId) update({mots_cles_verifies: $('manage-verified').checked});};
  $('manage-exercise-theme').onchange = () => {
    const value = $('manage-exercise-theme').value;
    if (value === NEW_THEME) {$('manage-new-theme-box').hidden = false; $('manage-new-theme').focus();}
    else if (currentId) update({theme: value});
  };
  $('manage-new-theme-ok').onclick = applyNewTheme;
  $('manage-new-theme').onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); applyNewTheme();}};
  $('manage-next-exercise').onclick = () => nextExercise();
  $('manage-verify-next').onclick = () => nextExercise(true);
  $('manage-reset').onclick = () => {if (currentId && confirm('Rétablir les mots-clés, le thème et le statut de cet exercice tels qu’ils étaient dans la base publiée ?')) {delete corrections[currentId]; persist();}};
  $('manage-list-prev').onclick = () => {page--; renderList();}; $('manage-list-next').onclick = () => {page++; renderList();};
  $('manage-delete').onclick = () => {
    const e = byId.get(currentId); if (!e) return;
    if (!confirm(`Supprimer l’exercice ${e.id} ?\n\nÀ l’enregistrement, il sera retiré de la base avec son code LaTeX, son PDF et ses aperçus. Tant que vous n’avez pas cliqué sur « Enregistrer dans la base », vous pouvez annuler.`)) return;
    corrections[e.id] = {mots_cles: [...e.mots_cles], mots_cles_verifies: e.mots_cles_verifies === true, theme: e.theme,
      original_mots_cles: [...originals.get(e.id).mots_cles], original_theme: originals.get(e.id).theme, supprime: true};
    persist(); toast(`${e.id} sera supprimé à l’enregistrement.`);
  };
  $('manage-undelete').onclick = () => {if (currentId) {delete corrections[currentId]; persist();}};
  $('manage-save').onclick = () => sendToBase(false);
  $('manage-test').onclick = () => sendToBase(true);
  $('manage-remember').onchange = () => {if (!$('manage-remember').checked) try {localStorage.removeItem(PASSWORD_STORAGE);} catch {}};
  try {
    const stored = localStorage.getItem(PASSWORD_STORAGE);
    if (stored) {$('manage-password').value = stored; $('manage-remember').checked = true;}
  } catch {}
  fetch(SAVE_CONFIG, {cache: 'no-cache'}).then(r => r.ok ? r.json() : {}).then(config => {
    saveUrl = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.scriptUrl || '') ? config.scriptUrl : '';
    refreshSave();
  }).catch(refreshSave);
  apply(); refreshThemeFilter(); currentId = [...byId.keys()].sort()[0] || null; renderList(); renderEditor();
  return {refresh() {renderList(); renderEditor();}};
}
