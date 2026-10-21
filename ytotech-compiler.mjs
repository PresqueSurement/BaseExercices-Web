import {latexDocument, documentFileName} from './core.mjs';

export const YTOTECH_ENDPOINT = 'https://latex.ytotech.com/builds/sync';
export const PACKAGE_NAMES = ['monpreambule.sty', 'perso-thierry.sty', 'slashbox.sty'];

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(binary);
}

export async function prepareYtoTechRequest(exercises, options, fetchBytes, tex) {
  if (!exercises.length || exercises.length > 100) throw new Error('Sélectionnez entre 1 et 100 exercices.');
  const missing = exercises.filter(e => e.missingImages?.length);
  if (missing.length) throw new Error('Des images manquent pour : ' + missing.map(e => e.id).join(', ') + '.');
  const resources = [{main: true, content: typeof tex === 'string' && tex ? tex : latexDocument(exercises, options)}];
  for (const name of PACKAGE_NAMES) resources.push({path: name, file: base64(await fetchBytes('latex/' + name))});
  const images = new Set(exercises.flatMap(e => Object.values(e.images)));
  for (const asset of images) resources.push({path: 'images/' + asset.split('/').pop(), file: base64(await fetchBytes(asset))});
  return {compiler: 'lualatex', resources};
}

export async function compileWithYtoTech(payload, fetcher = fetch) {
  const response = await fetcher(YTOTECH_ENDPOINT, {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) {
    let detail = '';
    try {
      const raw = await response.text();
      const missing = raw.match(/(?:LaTeX Error: File [`']([^`'\r\n]+)['`] not found|!\s*([^\r\n]{1,220}))/);
      if (missing) detail = missing[1] ? 'Package ou fichier absent : ' + missing[1] : missing[2];
    } catch {}
    throw new Error('La compilation a échoué' + (detail ? ' : ' + detail : ' (HTTP ' + response.status + '). Réessayez avec moins d’exercices.'));
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Le service n’a pas renvoyé un PDF valide.');
  return bytes;
}

export function attachYtoTechCompiler(getRequest, getExercises) {
  const $ = id => document.getElementById(id);
  let active = false, pdfUrl = null;
  const status = text => {$('ytotech-status').textContent = text;};
  $('compile-label').textContent = 'VOTRE PRÉAMBULE · COMPILATION EN LIGNE';
  $('compile-intro').textContent = 'Compilez votre devoir et téléchargez le PDF ici, sans compte ni connexion.';
  $('compile-footer').textContent = 'Les sources du devoir, ses images et les packages sont transmis à latex.ytotech.com pour la compilation. Ce service externe est en bêta.';
  $('compilation-note').textContent = 'La compilation en ligne utilise vos packages personnels.';
  for (const id of ['anonymous-panel', 'manual-compile-panel', 'direct-compile-panel', 'compile-status', 'compile-links']) $(id).hidden = true;
  $('ytotech-panel').hidden = false;
  $('make-latex').onclick = () => {
    if (!active) status(pdfUrl ? 'Le dernier PDF compilé reste disponible ci-dessous. Vous pouvez lancer une nouvelle compilation de la sélection actuelle.' : 'Votre sélection est prête. Cliquez sur Compiler le devoir.');
  };
  $('ytotech-start').onclick = async () => {
    if (active) return;
    active = true; $('ytotech-start').disabled = true;
    $('ytotech-result').hidden = true;
    if (pdfUrl) {URL.revokeObjectURL(pdfUrl); pdfUrl = null;}
    try {
      const request = getRequest();
      status('Préparation des exercices, images et packages…');
      const payload = await prepareYtoTechRequest(getExercises(request), request.options, async path => {
        const response = await fetch(path, {credentials: 'omit'});
        if (!response.ok) throw new Error('Fichier indisponible : ' + path);
        return new Uint8Array(await response.arrayBuffer());
      }, request.tex);   // le LaTeX (éventuellement modifié à la main) est celui de la fenêtre « LaTeX du devoir »
      status('Compilation LaTeX en cours… Laissez cette fenêtre ouverte.');
      const bytes = await compileWithYtoTech(payload);
      pdfUrl = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
      const result = $('ytotech-result');
      result.href = pdfUrl;
      result.download = documentFileName(request.options) + '.pdf';
      result.hidden = false;
      status('Compilation réussie ! Téléchargez votre PDF ci-dessous.');
    } catch (error) {
      status(['TimeoutError', 'AbortError'].includes(error.name) ? 'Le service met trop de temps à répondre. Réessayez plus tard.' : error instanceof TypeError ? 'Impossible de joindre le service de compilation. Vérifiez votre connexion.' : error.message);
    } finally {active = false; $('ytotech-start').disabled = false;}
  };
}
