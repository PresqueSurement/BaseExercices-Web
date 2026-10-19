export const levels = {seconde: 'Seconde', premiere: 'Première', terminale: 'Terminale'};
export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function filterExercises(exercises, filters) {
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return exercises.filter(e =>
    (!filters.level || e.niveau === filters.level) &&
    (!filters.theme || e.theme === filters.theme) &&
    (!filters.favorite || e.favori) &&
    (!filters.keyword || e.mots_cles.includes(filters.keyword)) &&
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
  const content = exercises.map(e => {
    let tex = e.tex;
    for (const [ref, asset] of Object.entries(e.images)) tex = tex.split('{' + ref + '}').join('{images/' + asset.split('/').pop() + '}');
    return `% --- ${e.id} ---\n${tex}\n\\bigskip`;
  }).join('\n\n');
  return '\\documentclass[dvipsnames,12pt]{article}\n\\usepackage{monpreambule}\n\\usepackage{multicol}\n\\begin{document}\n' +
    `\\begin{center}\\Large\\bfseries ${latexEscape(options.title)}\\end{center}\n` +
    `${latexEscape(options.className)}\\hfill ${latexEscape(options.duration)}\n\n` +
    (options.nameLine ? 'Nom : \\dotfill \\quad Prénom : \\dotfill\n\\bigskip\n' : '') +
    (options.columns === 2 ? '\\begin{multicols}{2}\n' : '') + content +
    (options.columns === 2 ? '\n\\end{multicols}' : '') + '\n\\end{document}\n';
}
