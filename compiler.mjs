import {loadCompilationService,attachAnonymousCompiler} from './anonymous-compiler.mjs';
import {attachYtoTechCompiler} from './ytotech-compiler.mjs';
const API='https://api.github.com/repos/PresqueSurement/BaseExercices';
const WORKFLOW='compiler-devoir.yml';
const ACTIONS='https://github.com/PresqueSurement/BaseExercices/actions/workflows/'+WORKFLOW;
const $=id=>document.getElementById(id);
export function compilerRequest(request,id=crypto.randomUUID()) {
  if(!request.ids.length||request.ids.length>100)throw new Error('La compilation accepte entre 1 et 100 exercices.');
  return {ref:'main',inputs:{demande:JSON.stringify({...request,tex:undefined}),request_id:id}};
}
export function findCompilation(runs,id){return runs.find(run=>run.display_title==='Devoir '+id&&run.event==='workflow_dispatch');}
export function attachCompiler(getRequest,toast,getExercises){
  let payload=null, running=false, currentRun=null, external=false;
  const status=text=>{$('compile-status').textContent=text;};
  const link=(text,url)=>{const a=document.createElement('a');a.className='secondary';a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener';return a;};
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function api(path,token,init={}){
    const response=await fetch(API+path,{...init,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(init.body?{'Content-Type':'application/json'}:{})},cache:'no-store'});
    if(!response.ok){
      let explanation='';try{explanation=(await response.json()).message||'';}catch{}
      if(response.status===401)throw new Error('La clé GitHub est invalide ou expirée.');
      if(response.status===403||response.status===404)throw new Error('La clé doit autoriser Actions en lecture et écriture sur le dépôt privé BaseExercices. Vérifiez aussi votre accès au dépôt.');
      if(response.status===422)throw new Error('GitHub a refusé cette demande de compilation : '+explanation);
      throw new Error('GitHub ne répond pas correctement (HTTP '+response.status+').');
    }
    return response.status===204?null:response.json();
  }
  async function showResult(run,token){
    const result=await api('/actions/runs/'+run.id+'/artifacts',token);
    const artifact=result.artifacts.find(a=>a.name==='devoir-compile'&&!a.expired);
    $('compile-links').replaceChildren(link('Voir la compilation sur GitHub',run.html_url));
    if(run.conclusion!=='success'){
      status('La compilation a échoué. Le journal et, si disponible, l’archive diagnostic-latex expliquent l’erreur sur GitHub.');return;
    }
    if(!artifact){status('Compilation réussie. Ouvrez GitHub pour récupérer les fichiers produits.');return;}
    $('compile-links').prepend(link('Télécharger le PDF et les sources (.zip)',run.html_url+'/artifacts/'+artifact.id));
    status('Compilation réussie ! Le ZIP privé contient le PDF, le LaTeX, les images et vos deux packages. Le téléchargement s’ouvre sur GitHub avec votre compte connecté. Disponible pendant 7 jours.');
  }
  async function start(){
    if(running||!payload)return;
    const token=$('compile-token').value.trim();
    if(!token){status('Pour un lancement direct, renseignez une clé limitée à Actions. Sinon, utilisez le parcours manuel ci-dessus.');return;}
    if(!/^[A-Za-z0-9_]+$/.test(token)){status('Le format de la clé est invalide. Copiez uniquement la clé GitHub, sans espace.');return;}
    running=true;$('start-compile').disabled=true;$('copy-request').disabled=true;
    $('compile-token').value='';$('compile-links').replaceChildren();
    let dispatched=false;
    try{
      status('Envoi de la sélection au dépôt privé…');
      await api('/actions/workflows/'+WORKFLOW+'/dispatches',token,{method:'POST',body:JSON.stringify(payload)});dispatched=true;
      for(let attempt=0;attempt<180;attempt++){
        if(!currentRun){
          const data=await api('/actions/workflows/'+WORKFLOW+'/runs?event=workflow_dispatch&per_page=30',token);
          currentRun=findCompilation(data.workflow_runs,payload.inputs.request_id);
        }else currentRun=await api('/actions/runs/'+currentRun.id,token);
        if(currentRun){
          if(!$('compile-links').childElementCount)$('compile-links').append(link('Suivre sur GitHub',currentRun.html_url));
          if(currentRun.status==='completed'){await showResult(currentRun,token);return;}
          status(currentRun.status==='queued'?'Compilation en attente sur GitHub…':'Compilation LaTeX en cours. Le premier démarrage peut prendre plusieurs minutes. Vous pouvez laisser cette fenêtre ouverte.');
        }else status('Demande reçue. Attente du démarrage sur GitHub…');
        await sleep(5000);
      }
      status('La compilation prend plus longtemps que prévu. Utilisez le lien GitHub pour suivre sa fin et télécharger le résultat.');
    }catch(error){status(error.message+(dispatched?' La demande a déjà été envoyée : vérifiez son état sur GitHub avant de relancer.':''));if(dispatched&&!$('compile-links').childElementCount)$('compile-links').append(link('Vérifier les compilations',ACTIONS));}
    finally{running=false;$('start-compile').disabled=dispatched;$('copy-request').disabled=false;}
  }
  $('make-latex').addEventListener('click',()=>{
    if(external){$('compile-dialog').showModal();return;}
    if(!running){try{payload=compilerRequest(getRequest());}catch(error){toast(error.message);return;}
      currentRun=null;$('compile-request').value=payload.inputs.demande;$('compile-links').replaceChildren();status('Votre sélection est prête. Choisissez un lancement manuel ou direct.');$('start-compile').disabled=false;}
    $('compile-dialog').showModal();
  });
  $('close-compile').onclick=()=>$('compile-dialog').close();
  $('copy-request').onclick=async()=>{try{await navigator.clipboard.writeText($('compile-request').value);status('Sélection copiée. Sur GitHub : Run workflow → collez-la dans « demande » → Run workflow. À la fin, téléchargez « devoir-compile » dans Artifacts.');}catch{$('compile-request').focus();$('compile-request').select();status('Sélectionnez et copiez le texte, puis collez-le dans le champ « demande » sur GitHub.');}};
  $('open-actions').href=ACTIONS;
  $('start-compile').onclick=start;
  fetch('compilation-config.json',{cache:'no-store'}).then(r=>r.ok?r.json():{}).then(async config=>{
    if(config.provider==='ytotech'&&getExercises){external=true;attachYtoTechCompiler(getRequest,getExercises);}
    else {const url=await loadCompilationService();if(url)attachAnonymousCompiler(getRequest,url);}
  }).catch(()=>{});
  $('forget-token').onclick=()=>{$('compile-token').value='';status(running?'Champ effacé. La clé de la compilation en cours sera libérée à la fin du suivi.':'Clé effacée. Aucune clé n’est enregistrée dans ce navigateur.');};
}
