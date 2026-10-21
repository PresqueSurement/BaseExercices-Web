import {documentFileName} from './core.mjs';
export function validateServiceUrl(value) {
  const url=new URL(value);
  const local=url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname);
  if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Adresse du service invalide.');
  return url.origin;
}
export async function loadCompilationService() {
  try{
    const response=await fetch('compilation-config.json',{cache:'no-store'});
    if(!response.ok)return null;
    const config=await response.json();
    return config.service_url?validateServiceUrl(config.service_url):null;
  }catch{return null;}
}
export function attachAnonymousCompiler(getRequest,baseUrl) {
  const $=id=>document.getElementById(id);
  let active=false,job=null,request=null;
  const status=text=>{$('anonymous-status').textContent=text;};
  async function api(path,init={}){
    const response=await fetch(baseUrl+path,{...init,credentials:'omit',cache:'no-store',headers:init.body?{'Content-Type':'application/json'}:{}});
    if(!response.ok){let text='Le service de compilation est momentanément indisponible.';try{text=(await response.json()).error||text;}catch{}throw new Error(text);}
    return response;
  }
  async function downloadPdf(){
    if(!job?.run_id)throw new Error('Le PDF n’est pas encore prêt.');
    const response=await api(`/jobs/${job.id}/download?run_id=${job.run_id}`);
    const data=new Uint8Array(await response.arrayBuffer());
    if(!globalThis.fflate)throw new Error('Rechargez la page pour activer le téléchargement du PDF.');
    const archive=globalThis.fflate.unzipSync(data,{filter:file=>/^(?:.*\/)?devoir\.pdf$/.test(file.name)});
    const file=Object.entries(archive).find(([name])=>/^(?:.*\/)?devoir\.pdf$/.test(name));
    if(!file)throw new Error('Le fichier PDF est absent du résultat.');
    const url=URL.createObjectURL(new Blob([file[1]],{type:'application/pdf'}));
    const a=document.createElement('a');a.href=url;a.download=documentFileName(request.options)+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    status('Votre PDF compilé est prêt. Le téléchargement a été lancé.');
  }
  async function start(){
    if(active)return;active=true;job=null;$('anonymous-start').disabled=true;$('anonymous-download').hidden=true;
    try{
      request=getRequest();status('Envoi du devoir à la compilation…');
      job=await (await api('/jobs',{method:'POST',body:JSON.stringify(request)})).json();
      let complete=false;
      for(let attempt=0;attempt<220;attempt++){
        const result=await (await api(`/jobs/${job.id}`+(job.run_id?'?run_id='+job.run_id:''))).json();
        job={...job,...result};
        if(result.status==='completed'){
          complete=true;
          if(result.conclusion!=='success')throw new Error('La compilation LaTeX a échoué pour cette sélection. Essayez avec moins d’exercices ou un autre énoncé.');
          $('anonymous-download').hidden=false;status('Compilation terminée. Téléchargement du PDF…');await downloadPdf();break;
        }
        status(result.status==='queued'?'Le devoir attend son tour. Vous n’avez pas besoin de vous connecter à GitHub.':'Compilation LaTeX en cours… Vous pouvez laisser cette fenêtre ouverte.');
        await new Promise(resolve=>setTimeout(resolve,6000));
      }
      if(!complete)throw new Error('La compilation prend plus longtemps que prévu. Consultez le suivi ultérieurement.');
    }catch(error){status(error.message+(job?.id?' La demande a été envoyée : attendez quelques minutes avant de relancer.':''));}
    finally{active=false;$('anonymous-start').disabled=false;}
  }
  $('anonymous-start').onclick=start;
  $('anonymous-download').onclick=()=>downloadPdf().catch(error=>status(error.message));
  $('make-latex').onclick=()=>{
    $('anonymous-panel').hidden=false;$('manual-compile-panel').hidden=true;$('direct-compile-panel').hidden=true;
    $('compile-status').hidden=true;$('compile-links').hidden=true;
    if(!active&&!job)status('Cliquez sur Compiler le devoir. Le PDF sera téléchargé ici, sans connexion GitHub.');
  };
}
