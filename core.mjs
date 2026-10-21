export const levels = {seconde: 'Seconde', premiere: 'Première', terminale: 'Terminale'};
export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function filterExercises(exercises, filters) {
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  const keywords = filters.keywords ?? (filters.keyword ? [filters.keyword] : []);
  return exercises.filter(e =>
    !e.supprime &&
    (!filters.level || e.niveau === filters.level) &&
    (!filters.theme || e.theme === filters.theme) &&
    (!filters.favorite || e.favori) &&
    (!keywords.length || (filters.keywordMode === 'any'
      ? keywords.some(key => e.mots_cles.includes(key))
      : keywords.every(key => e.mots_cles.includes(key)))) &&
    words.every(w => normalize([e.id, e.theme, ...e.mots_cles, e.source, e.text, e.commentaire].join(' ')).includes(w))
  );
}
// Titres de devoir : macros définies dans perso-thierry.sty (key = nom de la macro, sans « \\ »).
export const HEADERS = [
  {key: 'DS', menu: 'DS', title: 'DS de Mathématique'},
  {key: 'DSA', menu: 'DS — sujet A', title: 'DS de Mathématique (sujet A)'},
  {key: 'DSB', menu: 'DS — sujet B', title: 'DS de Mathématique (sujet B)'},
  {key: 'DST', menu: 'DST', title: 'DST de Mathématique'},
  {key: 'Test', menu: 'Test', title: 'Test de Mathématique'},
  {key: 'TestA', menu: 'Test — sujet A', title: 'Test de Mathématique (sujet A)'},
  {key: 'TestB', menu: 'Test — sujet B', title: 'Test de Mathématique (sujet B)'},
  {key: 'BacBlancSpe', menu: 'Bac blanc spécialité', title: 'Bac Blanc de Mathématique — spécialité'},
];
// Réglages de présentation : seuls ceux-ci existent ; tout le reste est ignoré (anciennes sauvegardes comprises).
export function cleanOptions(raw = {}) {
  const kind = raw.kind === 'fiche' ? 'fiche' : 'devoir';
  const header = HEADERS.some(h => h.key === raw.header) ? raw.header : 'DS';
  // Fiche : le complément du bandeau « Fiche … » (ex. « (arithmétique) ») et le titre écrit dans le cadre (plusieurs lignes possibles).
  const ficheLabel = String(raw.ficheLabel || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const ficheTitle = String(raw.ficheTitle || '').replace(/[ \t]+/g, ' ').split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('\n').slice(0, 300);
  const answerSpace = Math.min(120, Math.max(0, Number(raw.answerSpace) || 0));
  return {kind, header, ficheLabel, ficheTitle, columns: raw.columns === 2 ? 2 : 1, nameLine: raw.nameLine !== false, answerSpace,
    title: documentTitle({kind, header, ficheTitle})};
}
export function documentTitle(options) {
  if (options.kind === 'fiche') return options.ficheTitle ? options.ficheTitle.replace(/\n/g, ' ') : 'Fiche d’exercices';
  return (HEADERS.find(h => h.key === options.header) || HEADERS[0]).title;
}
// Nom de fichier (sans extension) : DS, DSA, TestB… ou Fiche-Theoremes-d-Euler.
export function documentFileName(options) {
  if (options.kind === 'fiche') {
    const words = String(options.ficheTitle || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-$/, '');
    return words ? 'Fiche-' + words : 'Fiche';
  }
  return (HEADERS.find(h => h.key === options.header) || HEADERS[0]).key;
}
export function safeSelection(data, available) {
  if (!data || data.version !== 1 || !Array.isArray(data.ids)) throw new Error('Ce fichier n’est pas une sélection compatible.');
  const ids = [...new Set(data.ids)];
  if (ids.some(id => typeof id !== 'string' || !available.has(id))) throw new Error('La sélection contient des exercices absents de cette base.');
  return {ids, options: cleanOptions(data.options || {})};
}
export function latexEscape(text) {
  return String(text).replace(/[\\{}$&#%_~^]/g, c => ({'\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}'}[c]));
}
export function latexDocument(exercises, rawOptions) {
  const options = cleanOptions(rawOptions);
  const content = exercises.map(e => {
    let tex = e.tex;
    for (const [ref, asset] of Object.entries(e.images)) tex = tex.split('{' + ref + '}').join('{images/' + asset.split('/').pop() + '}');
    return `% --- ${e.id} ---\n${tex}\n\\bigskip` + (options.answerSpace ? `\n\\vspace*{${options.answerSpace}pt}` : '');
  }).join('\n\n');
  const fiche = options.kind === 'fiche';
  const body = (options.columns === 2 ? '\\begin{DeuxCols}\n' + content + '\n\\end{DeuxCols}' : content);
  // Fiche : le cadre « mafiche » ne contient que le titre ; les exercices viennent ensuite, hors du cadre.
  const ficheBox = `\\begin{mafiche}[{${options.ficheLabel}}]\n\\begin{center}\n{\\Large\\sc\\bfseries ${options.ficheTitle.split('\n').join(' \\\\ ')}}\n\\end{center}\n\\end{mafiche}\n`;
  return '\\documentclass[dvipsnames,12pt,a4paper]{article}\n\\usepackage{monpreambule}\n' +
    '\\begin{document}\n' +
    (fiche ? ficheBox : `\\${options.header}\n`) +
    (options.nameLine ? '\\nom\n' : '') +
    body + '\n\\end{document}\n';
}
