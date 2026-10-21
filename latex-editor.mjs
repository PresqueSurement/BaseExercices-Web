import {latexDocument} from './core.mjs';

const DRAFT_STORAGE = 'atelier.latex.brouillon.v1';

// Fenêtre « LaTeX du devoir » : le code généré peut être modifié à la main ;
// le texte modifié est alors utilisé partout (sources, .tex, compilation en ligne).
export function attachLatexEditor({getExercises, getOptions, fileName, save, toast}) {
  const $ = id => document.getElementById(id);
  const signature = () => JSON.stringify({ids: getExercises().map(e => e.id), options: getOptions()});
  const generated = () => latexDocument(getExercises(), getOptions());
  let edited = false, text = '', base = '';
  try {
    const stored = JSON.parse(localStorage.getItem(DRAFT_STORAGE));
    if (stored && typeof stored.text === 'string' && typeof stored.base === 'string' && stored.text.length < 2000000) {edited = true; text = stored.text; base = stored.base;}
  } catch {}
  const keep = () => {
    try {
      if (edited) localStorage.setItem(DRAFT_STORAGE, JSON.stringify({text, base}));
      else localStorage.removeItem(DRAFT_STORAGE);
    } catch {}
  };
  const outdated = () => edited && base !== signature();
  function refresh() {
    const count = getExercises().length;
    $('open-latex').disabled = !count;
    $('latex-note').hidden = !edited;
    $('latex-note').textContent = outdated()
      ? '✎ LaTeX modifié à la main. Attention : la sélection ou les réglages ont changé depuis ; ouvrez le LaTeX pour le régénérer ou l’ajuster.'
      : '✎ LaTeX modifié à la main : ce texte est utilisé pour les sources et la compilation en ligne.';
    $('latex-state').textContent = edited ? 'Modifié à la main' : 'Généré automatiquement';
    $('latex-outdated').hidden = !outdated();
    $('latex-regenerate').disabled = !edited;
  }
  function open() {
    if (!getExercises().length) return;
    $('latex-text').value = edited ? text : generated();
    refresh(); $('latex-dialog').showModal(); $('latex-text').focus({preventScroll: true}); $('latex-text').setSelectionRange(0, 0);
  }
  $('open-latex').onclick = open;
  $('close-latex').onclick = () => $('latex-dialog').close();
  $('latex-text').oninput = () => {
    const value = $('latex-text').value;
    if (value === generated()) {edited = false; text = ''; base = '';}
    else {edited = true; text = value; base = signature();}
    keep(); refresh();
  };
  $('latex-regenerate').onclick = () => {
    if (!confirm('Régénérer le LaTeX à partir de la sélection et des réglages actuels ? Vos modifications à la main seront perdues.')) return;
    edited = false; text = ''; base = ''; keep(); $('latex-text').value = generated(); refresh(); toast('LaTeX régénéré.');
  };
  $('latex-regenerate-warning').onclick = $('latex-regenerate').onclick;
  $('latex-copy').onclick = async () => {
    try {await navigator.clipboard.writeText($('latex-text').value); toast('LaTeX copié.');}
    catch {$('latex-text').select(); toast('Copie impossible : le texte est sélectionné, utilisez Ctrl+C.');}
  };
  $('latex-download').onclick = () => save(new TextEncoder().encode($('latex-text').value), 'text/plain;charset=utf-8', fileName() + '.tex');
  $('latex-compile').onclick = () => {$('latex-dialog').close(); $('make-latex').click();};
  refresh();
  return {currentTex: () => edited ? text : generated(), isEdited: () => edited, refresh};
}
