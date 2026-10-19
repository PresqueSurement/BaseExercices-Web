import {normalize} from './core.mjs';

export function attachKeywordPicker(getScope, getFilters, onChange) {
  const $ = id => document.getElementById(id);
  let expanded = false;
  const label = key => key.replaceAll('_', ' ');
  function chip(key, selected, removeOnly = false) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'keyword-chip' + (selected ? ' is-selected' : '');
    button.dataset.keyword = key;
    button.dataset.removeOnly = String(removeOnly);
    button.textContent = (selected ? '✓ ' : '+ ') + label(key) + (removeOnly ? ' ×' : '');
    button.setAttribute('aria-label', (removeOnly ? 'Retirer ' : '') + label(key));
    if (!removeOnly) button.setAttribute('aria-pressed', String(selected));
    button.onclick = () => {
      const filters = getFilters();
      onChange(filters.keywords.includes(key) ? filters.keywords.filter(k => k !== key) : [...filters.keywords, key]);
      render();
      const candidates = [...$('keyword-picker').querySelectorAll('button[data-keyword]')].filter(b => b.dataset.keyword === key);
      const target = candidates.find(b => b.dataset.removeOnly === String(removeOnly)) || candidates[0] || $('keyword-search');
      target.focus({preventScroll: true});
    };
    return button;
  }
  function render() {
    const filters = getFilters();
    const keys = [...new Set(getScope().flatMap(e => e.mots_cles))].sort((a, b) => label(a).localeCompare(label(b), 'fr'));
    const query = normalize($('keyword-search').value).trim();
    const matches = keys.filter(key => normalize(label(key)).includes(query));
    const visible = expanded || query ? matches : matches.slice(0, 18);
    $('keyword-chips').replaceChildren(...visible.map(key => chip(key, filters.keywords.includes(key))));
    $('keyword-empty').hidden = !!matches.length;
    $('keyword-selected').replaceChildren(...filters.keywords.map(key => chip(key, true, true)));
    $('keyword-selection-row').hidden = !filters.keywords.length;
    $('keyword-selection-count').textContent = `${filters.keywords.length} mot${filters.keywords.length > 1 ? 's' : ''}-clé${filters.keywords.length > 1 ? 's' : ''} sélectionné${filters.keywords.length > 1 ? 's' : ''}`;
    $('keyword-more').hidden = !!query || keys.length <= 18;
    $('keyword-more').textContent = expanded ? 'Réduire les mots-clés' : `Voir les ${keys.length} mots-clés`;
    $('keyword-more').setAttribute('aria-expanded', String(expanded));
    $('keyword-all').setAttribute('aria-pressed', String(filters.keywordMode !== 'any'));
    $('keyword-any').setAttribute('aria-pressed', String(filters.keywordMode === 'any'));
  }
  $('keyword-search').oninput = render;
  $('keyword-more').onclick = () => {expanded = !expanded; render();};
  $('keyword-clear').onclick = () => {onChange([]); render();};
  for (const mode of ['all', 'any']) $('keyword-' + mode).onclick = () => {onChange(getFilters().keywords, mode); render();};
  return {render, reset() {expanded = false; $('keyword-search').value = ''; render();}};
}
