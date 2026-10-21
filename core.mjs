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
export function safeSelection(data, available) {
  if (!data || data.version !== 1 || !Array.isArray(data.ids)) throw new Error('Ce fichier n’est pas une sélection compatible.');
  const ids = [...new Set(data.ids)];
  if (ids.some(id => typeof id !== 'string' || !available.has(id))) throw new Error('La sélection contient des exercices absents de cette base.');
  const raw = data.options || {};
  return {ids, options: {
    title: String(raw.title || 'Devoir de mathématiques').slice(0, 180),
    className: String(raw.className || '').slice(0, 100),
    duration: String(raw.duration || '').slice(0, 80),
    columns: raw.columns === 2 ? 2 : 1, nameLine: raw.nameLine !== false,
    answerSpace: Math.min(120, Math.max(0, Number(raw.answerSpace) || 0)),
    pagePerExercise: !!raw.pagePerExercise,
  }};
}
export function latexEscape(text) {
  return String(text).replace(/[\\{}$&#%_~^]/g, c => ({'\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}'}[c]));
}
export function latexDocument(exercises, options) {
  const content = exercises.map((e, index) => {
    let tex = e.tex;
    for (const [ref, asset] of Object.entries(e.images)) tex = tex.split('{' + ref + '}').join('{images/' + asset.split('/').pop() + '}');
    return (index && options.pagePerExercise ? '\\clearpage\n' : '') + `% --- ${e.id} ---\n${tex}\n\\bigskip` +
      (options.answerSpace ? `\n\\vspace*{${Math.min(120, Math.max(0, Number(options.answerSpace) || 0))}pt}` : '');
  }).join('\n\n');
  const columns = options.columns === 2 && !options.pagePerExercise;
  return '\\documentclass[dvipsnames,12pt,a4paper]{article}\n\\usepackage{monpreambule}\n\\begin{document}\n' +
    `\\begin{center}\\Large\\bfseries ${latexEscape(options.title)}\\end{center}\n` +
    `${latexEscape(options.className)}\\hfill ${latexEscape(options.duration)}\n\n` +
    (options.nameLine ? 'Nom : \\dotfill \\quad Prénom : \\dotfill\n\\bigskip\n' : '') +
    (columns ? '\\begin{DeuxCols}\n' : '') + content +
    (columns ? '\n\\end{DeuxCols}' : '') + '\n\\end{document}\n';
}
