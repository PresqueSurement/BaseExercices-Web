import {levels, filterExercises, safeSelection, latexDocument} from './core.mjs';
import {createSubjectPdf} from './pdf.mjs';
import {attachCompiler} from './compiler.mjs';
import {PACKAGE_NAMES} from './ytotech-compiler.mjs';
const $ = id => document.getElementById(id);
const PAGE_SIZE = 12, STORAGE = 'atelier.selection.v1', NOTES = 'atelier.annotations.v1';
let exercises = [], byId = new Map(), filtered = [], selected = [], options = {}, page=0, preview=null;
let annotations = {}, bytesCache = new Map(), busy=false;
let filters = {query:'', level:'', theme:'', keyword:'', favorite:false};
const defaults = {title:'Devoir de mathématiques',className:'',duration:'',columns:1,nameLine:true,answerSpace:0,pagePerExercise:false};
function el(tag, cls, text) {const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;}
function button(text, cls, action) {const b=el('button',cls,text);b.type='button';b.addEventListener('click',action);return b;}
let toastTimer;
function toast(text) {$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
function readStorage(key, fallback) {try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function writeStorage(key,value) {try{localStorage.setItem(key,JSON.stringify(value));}catch{toast('Sauvegarde locale indisponible : exportez votre sélection pour la conserver.');}}
function persist() {writeStorage(STORAGE,{version:1,ids:selected,options});}
function applyAnnotations() {for(const e of exercises){const note=annotations[e.id];if(note){e.favori=note.favorite??e.originalFavorite;e.commentaire=note.note??e.originalNote;}else{e.favori=e.originalFavorite;e.commentaire=e.originalNote;}}}
function saveAnnotation(e, changes) {annotations[e.id]={...(annotations[e.id]||{}),...changes};applyAnnotations();writeStorage(NOTES,annotations);renderResults();}
function slug() {return (options.title||'devoir').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9-]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)||'devoir';}
function download(data, type, name) {const url=URL.createObjectURL(new Blob([data],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function jsonDownload(data,name){download(JSON.stringify(data,null,2),'application/json',name);}
async function fetchBytes(path) {
  if (!bytesCache.has(path)) bytesCache.set(path,fetch(path).then(async r=>{if(!r.ok)throw new Error('Ressource indisponible : '+path);return new Uint8Array(await r.arrayBuffer());}).catch(error=>{bytesCache.delete(path);throw error;}));
  return bytesCache.get(path);
}
function toggleSelection(id) {if(busy)return;if(selected.includes(id))selected=selected.filter(x=>x!==id);else selected.push(id);persist();renderSelection();renderResults();if(preview?.id===id)previewButton();}
function previewButton() {$('preview-add').textContent=selected.includes(preview.id)?'Retirer du devoir':'Ajouter au devoir';}
function optionsToForm(){for(const [id,key] of [['title','title'],['class-name','className'],['duration','duration'],['columns','columns'],['answer-space','answerSpace']])$(id).value=options[key];$('name-line').checked=options.nameLine;$('page-per-exercise').checked=options.pagePerExercise;}
function readOptions(){options={title:$('title').value.trim()||defaults.title,className:$('class-name').value.trim(),duration:$('duration').value.trim(),columns:Number($('columns').value),answerSpace:Number($('answer-space').value),nameLine:$('name-line').checked,pagePerExercise:$('page-per-exercise').checked};persist();}
function showView(subject){$('subject-view').hidden=!subject;$('library-view').hidden=subject;$('library-tab').classList.toggle('active',!subject);$('subject-tab').classList.toggle('active',subject);$('library-tab').setAttribute('aria-pressed',String(!subject));$('subject-tab').setAttribute('aria-pressed',String(subject));$('selection-tray').hidden=subject;window.scrollTo({top:0,behavior:'smooth'});if(subject)renderSelection();}
function updateFilterChoices(){
  const scope=exercises.filter(e=>!filters.level||e.niveau===filters.level);
  const themes=[...new Set(scope.map(e=>e.theme))].sort((a,b)=>a.localeCompare(b,'fr'));
  if(!themes.includes(filters.theme))filters.theme='';
  $('theme').replaceChildren(new Option('Tous les thèmes',''),...themes.map(t=>new Option(t,t)));$('theme').value=filters.theme;
  const keys=[...new Set(scope.filter(e=>!filters.theme||e.theme===filters.theme).flatMap(e=>e.mots_cles))].sort((a,b)=>a.localeCompare(b,'fr'));
  if(!keys.includes(filters.keyword))filters.keyword='';
  $('keyword').replaceChildren(new Option('Tous les mots-clés',''),...keys.map(k=>new Option(k.replaceAll('_',' '),k)));$('keyword').value=filters.keyword;
}
function renderResults(){
  filtered=filterExercises(exercises,filters);
  const sort=$('sort').value;
  filtered.sort((a,b)=>(sort==='theme'?a.theme.localeCompare(b.theme,'fr'):sort==='level'?Object.keys(levels).indexOf(a.niveau)-Object.keys(levels).indexOf(b.niveau):0)||a.id.localeCompare(b.id));
  page=Math.max(0,Math.min(page,Math.ceil(filtered.length/PAGE_SIZE)-1));
  $('result-count').textContent=`${filtered.length.toLocaleString('fr-FR')} exercice${filtered.length!==1?'s':''}${filtered.length<exercises.length?' trouvé'+(filtered.length!==1?'s':''):''}`;
  const nodes=filtered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(e=>{
    const card=el('article','exercise-card'+(selected.includes(e.id)?' selected':''));
    const top=el('div','card-top');top.append(el('span','level-badge',levels[e.niveau]),el('span','exercise-id',e.id));
    const fav=button(e.favori?'★':'☆','favorite-button',()=>saveAnnotation(e,{favorite:!e.favori}));fav.setAttribute('aria-label',`${e.favori?'Retirer':'Ajouter'} ${e.id} ${e.favori?'des':'aux'} favoris`);fav.setAttribute('aria-pressed',String(!!e.favori));top.append(fav);
    const pdfPreview=button('','pdf-card-preview',()=>openPreview(e));
    pdfPreview.setAttribute('aria-label',`Ouvrir le PDF de ${e.id}`);
    const pages=el('span','pdf-card-pages');
    for(const [index,view] of (e.previews||[]).entries()){
      const image=el('img');image.src=view.src;image.alt=`Énoncé PDF ${e.id}, page ${index+1}`;
      image.width=view.width;image.height=view.height;image.loading='lazy';image.decoding='async';pages.append(image);
    }
    if(!pages.childElementCount)pages.append(el('span','muted','Ouvrir l’aperçu PDF'));
    const caption=el('span','pdf-card-caption',`Aperçu PDF${e.previews?.length>1?' · '+e.previews.length+' pages':''} · Agrandir ↗`);
    pdfPreview.append(pages,caption);
    const tags=el('div','tags');for(const keyword of e.mots_cles.slice(0,4))tags.append(el('span','tag',keyword.replaceAll('_',' ')));if(e.mots_cles.length>4)tags.append(el('span','tag','+'+(e.mots_cles.length-4)));
    const bottom=el('div','card-bottom');bottom.append(button('Consulter l’énoncé ↗','text-button',()=>openPreview(e)),button(selected.includes(e.id)?'✓ Sélectionné':'+ Ajouter','secondary',()=>toggleSelection(e.id)));
    card.append(top,el('h3',null,e.theme.replaceAll('_',' ')),pdfPreview,tags,bottom);return card;
  });
  if(!nodes.length){const empty=el('div','empty');empty.append(el('h3',null,'Aucun exercice trouvé'),el('p',null,'Essayez un autre mot ou élargissez les filtres.'));nodes.push(empty);}
  $('results').replaceChildren(...nodes);$('page-number').textContent=`Page ${page+1} / ${Math.max(1,Math.ceil(filtered.length/PAGE_SIZE))}`;$('previous').disabled=page===0;$('next').disabled=(page+1)*PAGE_SIZE>=filtered.length;
}
function renderSelection(){
  const count=selected.length;$('nav-count').textContent=count;$('subject-count').textContent=count;$('tray-count').textContent=`${count} exercice${count!==1?'s':''} sélectionné${count!==1?'s':''}`;
  $('make-pdf').disabled=busy||!count;$('make-zip').disabled=busy||!count;$('make-latex').disabled=busy||!count;
  $('clear-selection').disabled=busy||!count;$('save-selection').disabled=busy||!count;
  $('load-selection').disabled=busy;
  const nodes=selected.map((id,i)=>{
    const e=byId.get(id),row=el('div','subject-item');const info=el('div','subject-info');info.append(el('strong',null,e.theme.replaceAll('_',' ')),el('span',null,`${e.id} · ${levels[e.niveau]}`));
    const controls=el('div','subject-controls');
    const up=button('↑','icon-button',()=>move(i,-1)),down=button('↓','icon-button',()=>move(i,1)),see=button('Voir','icon-button',()=>openPreview(e)),remove=button('×','icon-button danger',()=>toggleSelection(id));
    up.disabled=busy||i===0;down.disabled=busy||i===selected.length-1;remove.disabled=busy;
    up.setAttribute('aria-label',`Monter ${id}`);down.setAttribute('aria-label',`Descendre ${id}`);remove.setAttribute('aria-label',`Retirer ${id}`);
    controls.append(up,down,see,remove);row.append(el('span','order',String(i+1)),info,controls);return row;
  });
  if(!nodes.length){const empty=el('div','empty');empty.append(el('h3',null,'La page est encore blanche.'),el('p',null,'Ajoutez des exercices depuis la bibliothèque.'));nodes.push(empty);}
  $('subject-list').replaceChildren(...nodes);
}
function move(index,delta){if(busy)return;[selected[index],selected[index+delta]]=[selected[index+delta],selected[index]];persist();renderSelection();}
function openPreview(e){preview=e;$('preview-id').textContent=`${e.id} · ${levels[e.niveau]}`;$('preview-title').textContent=e.theme.replaceAll('_',' ');$('pdf-preview').src=e.pdf+'#toolbar=1&view=FitH';$('download-pdf').href=e.pdf;$('download-pdf').download=e.id+'.pdf';$('tex-preview').textContent=e.tex;$('exercise-note').value=e.commentaire||'';$('preview-favorite').textContent=e.favori?'★ Favori':'☆ Favori';previewButton();setPreviewMode(false);if(!$('exercise-dialog').open)$('exercise-dialog').showModal();}
function setPreviewMode(tex){$('pdf-preview').hidden=tex;$('tex-preview').hidden=!tex;$('show-pdf').setAttribute('aria-pressed',String(!tex));$('show-tex').setAttribute('aria-pressed',String(tex));}
async function createPdf(){
  readOptions();const list=selected.map(id=>byId.get(id)),opts={...options};busy=true;renderSelection();$('export-status').textContent='Préparation du devoir…';
  try{const bytes=await createSubjectPdf(list,opts,fetchBytes,(i,n)=>$('export-status').textContent=`Assemblage des exercices : ${i} / ${n}`);download(bytes,'application/pdf',slug()+'.pdf');$('export-status').textContent='Votre PDF est prêt. Le téléchargement a été lancé.';}
  catch(error){$('export-status').textContent='Échec : '+error.message;}
  finally{busy=false;renderSelection();}
}
async function createZip(){
  readOptions();const list=selected.map(id=>byId.get(id)),opts={...options};busy=true;renderSelection();$('export-status').textContent='Préparation des sources…';
  try{
    if(!globalThis.fflate)throw new Error('Le module ZIP n’a pas chargé. Rechargez la page.');
    const {strToU8,zipSync}=globalThis.fflate;
    const missing=list.filter(e=>e.missingImages.length).map(e=>`${e.id} : ${e.missingImages.join(', ')}`);
    const files={'devoir.tex':strToU8(latexDocument(list,opts)),'selection.json':strToU8(JSON.stringify({version:1,ids:list.map(e=>e.id),options:opts},null,2)),
      'LISEZ-MOI.txt':strToU8('Sources du devoir\n\nLe fichier devoir.tex reprend les exercices sélectionnés. Les packages personnels sont inclus, ainsi que les images nécessaires. Une distribution LaTeX complète et récente est requise.\n\nPour compiler : lualatex devoir.tex\n\nImages absentes des sources :\n'+(missing.join('\n')||'Aucune image manquante détectée.'))};
    for(const name of PACKAGE_NAMES)files[name]=await fetchBytes('latex/'+name);
    for(const e of list){files['exercices/'+e.id+'.tex']=strToU8(e.tex);for(const asset of Object.values(e.images)){const name='images/'+asset.split('/').pop();if(!files[name])files[name]=await fetchBytes(asset);}}
    download(zipSync(files),'application/zip',slug()+'-sources.zip');$('export-status').textContent='Sources téléchargées.'+(missing.length?' Attention : certaines images LaTeX sont absentes ; voir LISEZ-MOI.txt.':'');
  }catch(error){$('export-status').textContent='Échec : '+error.message;}finally{busy=false;renderSelection();}
}
async function readJsonFile(file){if(!file)throw new Error('Aucun fichier choisi.');if(file.size>5*1024*1024)throw new Error('Fichier trop volumineux (maximum 5 Mo).');return JSON.parse(await file.text());}
function wireEvents(){
  $('library-tab').onclick=()=>showView(false);for(const id of ['subject-tab','open-subject'])$(id).onclick=()=>showView(true);$('back-library').onclick=()=>showView(false);
  $('query').oninput=()=>{filters.query=$('query').value;page=0;renderResults();};
  for(const [id,key]of [['level','level'],['theme','theme'],['keyword','keyword']])$(id).onchange=()=>{filters[key]=$(id).value;if(id==='level')filters.theme='';page=0;updateFilterChoices();renderResults();};
  $('favorites').onchange=()=>{filters.favorite=$('favorites').checked;page=0;renderResults();};$('sort').onchange=()=>{page=0;renderResults();};
  $('reset-filters').onclick=()=>{filters={query:'',level:'',theme:'',keyword:'',favorite:false};$('query').value='';$('level').value='';$('favorites').checked=false;page=0;updateFilterChoices();renderResults();};
  $('previous').onclick=()=>{page--;renderResults();$('result-count').scrollIntoView({behavior:'smooth',block:'start'});};$('next').onclick=()=>{page++;renderResults();$('result-count').scrollIntoView({behavior:'smooth',block:'start'});};
  $('close-dialog').onclick=()=>$('exercise-dialog').close();$('exercise-dialog').addEventListener('click',e=>{if(e.target===$('exercise-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('preview-add').onclick=()=>toggleSelection(preview.id);$('preview-favorite').onclick=()=>{saveAnnotation(preview,{favorite:!preview.favori});$('preview-favorite').textContent=preview.favori?'★ Favori':'☆ Favori';};
  $('exercise-note').oninput=()=>saveAnnotation(preview,{note:$('exercise-note').value});$('download-tex').onclick=()=>download(preview.tex,'text/plain;charset=utf-8',preview.id+'.tex');$('show-pdf').onclick=()=>setPreviewMode(false);$('show-tex').onclick=()=>setPreviewMode(true);
  for(const id of ['title','class-name','duration','columns','answer-space','name-line','page-per-exercise'])$(id).addEventListener('change',readOptions);
  $('clear-selection').onclick=()=>{if(confirm('Vider la sélection du devoir ? Les exercices de la base seront conservés.')){selected=[];persist();renderSelection();renderResults();}};
  $('save-selection').onclick=()=>{readOptions();jsonDownload({version:1,ids:selected,options},slug()+'-selection.json');};
  $('load-selection').onchange=async e=>{try{const data=safeSelection(await readJsonFile(e.target.files[0]),byId);if(selected.length&&!confirm('Remplacer la sélection actuelle par celle du fichier ?'))return;selected=data.ids;options=data.options;optionsToForm();persist();renderSelection();renderResults();toast('Sélection importée.');}catch(error){toast(error.message);}finally{e.target.value='';}};
  $('make-pdf').onclick=createPdf;$('make-zip').onclick=createZip;
  attachCompiler(()=>{readOptions();return {version:1,ids:[...selected],options:{...options}};},toast,request=>request.ids.map(id=>byId.get(id)));
  $('export-notes').onclick=()=>jsonDownload({version:1,annotations},'mes-annotations.json');
  $('import-notes').onchange=async e=>{try{const data=await readJsonFile(e.target.files[0]);if(data.version!==1||!data.annotations||Array.isArray(data.annotations)||typeof data.annotations!=='object')throw new Error('Fichier d’annotations incompatible.');for(const [id,note]of Object.entries(data.annotations)){if(byId.has(id)&&note&&typeof note==='object')annotations[id]={favorite:typeof note.favorite==='boolean'?note.favorite:byId.get(id).favori,note:typeof note.note==='string'?note.note.slice(0,10000):''};}writeStorage(NOTES,annotations);applyAnnotations();renderResults();toast('Annotations importées.');}catch(error){toast(error.message);}finally{e.target.value='';}};
}
async function main(){
  try{const response=await fetch('catalogue.json');if(!response.ok)throw new Error('Le catalogue est indisponible.');exercises=await response.json();for(const e of exercises){e.originalFavorite=e.favori;e.originalNote=e.commentaire;}byId=new Map(exercises.map(e=>[e.id,e]));annotations=readStorage(NOTES,{});if(!annotations||typeof annotations!=='object'||Array.isArray(annotations))annotations={};applyAnnotations();
    options={...defaults};const stored=readStorage(STORAGE,null);if(stored){try{const restored=safeSelection(stored,byId);selected=restored.ids;options=restored.options;}catch{toast('L’ancienne sélection ne correspond plus à la base. Vous pouvez en créer une nouvelle.');}}
    $('total-count').textContent=exercises.length.toLocaleString('fr-FR');optionsToForm();wireEvents();updateFilterChoices();renderResults();renderSelection();
  }catch(error){$('result-count').textContent='La bibliothèque n’a pas pu charger.';const message=el('div','empty');message.append(el('p',null,error.message+' Rechargez la page.'));$('results').replaceChildren(message);}
}
main();
