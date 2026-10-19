import {normalize, levels} from './core.mjs';

export const MANAGEMENT_STORAGE = 'atelier.corrections-mots-cles.v1';
export const CORRECTIONS_TYPE = 'atelier.corrections-mots-cles';
const sameKeywords = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function validateCorrections(data, available, allowed) {
  if (!data || data.version !== 1 || data.type !== CORRECTIONS_TYPE || !data.corrections || Array.isArray(data.corrections) || typeof data.corrections !== 'object') throw new Error('Ce fichier n’est pas un export de corrections compatible.');
  const result = Object.create(null);
  for (const [id, entry] of Object.entries(data.corrections)) {
    if (!available.has(id)) throw new Error('Exercice absent de cette base : ' + id);
    if (!entry || !Array.isArray(entry.mots_cles) || entry.mots_cles.length > 200 || entry.mots_cles.some(key => typeof key !== 'string' || !allowed.has(key)) || typeof entry.mots_cles_verifies !== 'boolean') throw new Error('Correction invalide pour ' + id);
    const original = entry.original_mots_cles;
    if (original !== undefined && (!Array.isArray(original) || original.length > 200 || original.some(key => typeof key !== 'string' || key.length > 100))) throw new Error('Historique invalide pour ' + id);
    result[id] = {mots_cles: [...new Set(entry.mots_cles)], mots_cles_verifies: entry.mots_cles_verifies,
      original_mots_cles: [...(original || available.get(id).mots_cles)]};
  }
  return result;
}

export function correctionsFile(corrections) {
  return {version: 1, type: CORRECTIONS_TYPE, exportedAt: new Date().toISOString(), corrections};
}

export function attachManagement(exercises, onChange, download, toast) {
  const $ = id => document.getElementById(id);
  const byId = new Map(exercises.map(e => [e.id, e]));
  const originals = new Map(exercises.map(e => [e.id, {mots_cles: [...e.mots_cles], mots_cles_verifies: e.mots_cles_verifies === true}]));
  const allowed = new Set(exercises.flatMap(e => e.mots_cles));
  const keys = [...allowed].sort((a, b) => a.localeCompare(b, 'fr'));
  let corrections = Object.create(null), currentId = null, list = [], page = 0;
  const SIZE = 20;
  const status = text => {$('manage-storage-status').textContent = text;};
  try {
    const raw = localStorage.getItem(MANAGEMENT_STORAGE);
    if (raw) corrections = validateCorrections(JSON.parse(raw), byId, allowed);
  } catch {status('La sauvegarde de corrections est illisible ou incompatible. Vous pouvez importer un export valide.');}

  function apply() {
    for (const e of exercises) {
      const value = corrections[e.id] || originals.get(e.id);
      e.mots_cles = [...value.mots_cles]; e.mots_cles_verifies = value.mots_cles_verifies;
    }
  }
  function persist() {
    apply();
    try {localStorage.setItem(MANAGEMENT_STORAGE, JSON.stringify(correctionsFile(corrections))); status('Corrections enregistrées dans ce navigateur. Exportez-les pour les conserver ou changer d’ordinateur.');}
    catch {status('Le navigateur n’a pas pu enregistrer les corrections. Elles sont en mémoire : exportez-les maintenant.');}
    onChange(); renderList(); renderEditor();
  }
  function update(keywords, verified) {
    const e = byId.get(currentId), original = originals.get(currentId);
    if (!e) return;
    if (sameKeywords(keywords, original.mots_cles) && verified === original.mots_cles_verifies) delete corrections[currentId];
    else corrections[currentId] = {mots_cles: [...keywords], mots_cles_verifies: verified,
      original_mots_cles: corrections[currentId]?.original_mots_cles || [...original.mots_cles]};
    persist();
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
      const info = document.createElement('span'); info.textContent = `${levels[e.niveau]} · ${e.mots_cles.length} mots-clés · ${e.mots_cles_verifies ? '✓ Vérifié' : 'À vérifier'}${corrections[e.id] ? ' · modifié ici' : ''}`;
      button.append(title, info); button.onclick = () => {currentId = e.id; $('manage-keyword-search').value = ''; renderList(); renderEditor();}; return button;
    }));
    if (!list.length) $('manage-list').textContent = 'Aucun exercice pour ces filtres.';
    $('manage-list-page').textContent = `${page + 1} / ${Math.max(1, Math.ceil(list.length / SIZE))}`;
    $('manage-list-prev').disabled = !page; $('manage-list-next').disabled = (page + 1) * SIZE >= list.length;
    const verified = exercises.filter(e => e.mots_cles_verifies).length;
    const changed = Object.keys(corrections).length;
    $('manage-progress').textContent = `${verified} / ${exercises.length} vérifiés · ${changed} exercice${changed > 1 ? 's' : ''} avec une correction locale`;
    $('manage-export').disabled = !Object.keys(corrections).length;
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
        update(selected ? e.mots_cles.filter(k => k !== key) : [...e.mots_cles, key], false);
        const target = [...$('manage-keywords').querySelectorAll('button')].find(b => b.dataset.keyword === key) || $('manage-keyword-search');
        target.focus({preventScroll: true});
      };
      return button;
    };
    $('manage-current-keywords').replaceChildren(...e.mots_cles.map(key => makeChip(key, true)));
    if (!e.mots_cles.length) $('manage-current-keywords').textContent = 'Aucun mot-clé attribué.';
    const visible = keys.filter(key => normalize(key.replaceAll('_', ' ')).includes(query));
    $('manage-keywords').replaceChildren(...visible.map(key => makeChip(key)));
    $('manage-no-keywords').hidden = !!visible.length;
  }
  function renderEditor() {
    const e = byId.get(currentId);
    $('manage-editor').hidden = !e; $('manage-empty').hidden = !!e;
    if (!e) return;
    $('manage-exercise-heading').textContent = `${e.id} · ${e.theme.replaceAll('_', ' ')}`;
    $('manage-exercise-info').textContent = `${levels[e.niveau]}${e.source ? ' · Source : ' + e.source : ''}`;
    $('manage-verified').checked = !!e.mots_cles_verifies;
    $('manage-current-state').textContent = e.mots_cles_verifies ? '✓ Mots-clés vérifiés' : 'Mots-clés à vérifier';
    $('manage-reset').disabled = !corrections[e.id];
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
    if (verify && currentId) update(byId.get(currentId).mots_cles, true);
    if (next) {currentId = next.id; page = Math.floor(Math.max(0, list.findIndex(e => e.id === currentId)) / SIZE); $('manage-keyword-search').value = ''; renderList(); renderEditor();}
    else toast('Vous êtes au dernier exercice de cette liste.');
  }
  for (const id of ['manage-query', 'manage-level', 'manage-theme', 'manage-state']) $(id).addEventListener(id === 'manage-query' ? 'input' : 'change', () => {page = 0; renderList(); if (!list.some(e => e.id === currentId)) {currentId = list[0]?.id || null; renderList(); renderEditor();}});
  $('manage-keyword-search').oninput = renderKeywords;
  $('manage-verified').onchange = () => {if (currentId) update(byId.get(currentId).mots_cles, $('manage-verified').checked);};
  $('manage-next-exercise').onclick = () => nextExercise();
  $('manage-verify-next').onclick = () => nextExercise(true);
  $('manage-reset').onclick = () => {if (currentId && confirm('Rétablir les mots-clés et le statut de cet exercice tels qu’ils étaient dans la base publiée ?')) {delete corrections[currentId]; persist();}};
  $('manage-list-prev').onclick = () => {page--; renderList();}; $('manage-list-next').onclick = () => {page++; renderList();};
  $('manage-export').onclick = () => download(JSON.stringify(correctionsFile(corrections), null, 2), 'application/json', 'corrections-base-exercices-' + new Date().toISOString().slice(0, 10) + '.json');
  $('manage-import').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) throw new Error('Fichier trop volumineux (maximum 5 Mo).');
      const imported = validateCorrections(JSON.parse(await file.text()), byId, allowed);
      const conflicts = Object.keys(imported).filter(id => corrections[id] && JSON.stringify(imported[id]) !== JSON.stringify(corrections[id]));
      if (conflicts.length && !confirm(`Remplacer les corrections locales de ${conflicts.length} exercice(s) par celles du fichier ?`)) return;
      corrections = Object.assign(Object.create(null), corrections, imported); persist(); toast('Corrections importées dans ce navigateur.');
    } catch (error) {toast(error.message);} finally {event.target.value = '';}
  };
  $('manage-theme').replaceChildren(new Option('Tous les thèmes', ''), ...[...new Set(exercises.map(e => e.theme))].sort((a, b) => a.localeCompare(b, 'fr')).map(theme => new Option(theme, theme)));
  apply(); currentId = [...byId.keys()].sort()[0] || null; renderList(); renderEditor();
  return {refresh() {renderList(); renderEditor();}};
}
