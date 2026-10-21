// Assemble les énoncés vectoriels existants : aucune recompilation LaTeX.
export async function createSubjectPdf(exercises, options, loadBytes, progress = () => {}) {
  if (!exercises.length) throw new Error('Choisissez au moins un exercice.');
  const {PDFDocument, StandardFonts, rgb} = globalThis.PDFLib || {};
  if (!PDFDocument) throw new Error('Le module PDF n’a pas chargé. Rechargez la page.');
  const pdf = await PDFDocument.create();
  pdf.setTitle(options.title); pdf.setCreator('Atelier d’exercices');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 595.28, H = 841.89, M = 36, bottom = 36, gap = 20;
  const columns = options.columns === 2 ? 2 : 1;
  const colW = (W - 2 * M - gap * (columns - 1)) / columns;
  const ink = rgb(.10, .15, .13);
  let page, y, column = 0, top = H - M, pageNumber = 0;
  const clean = (text) => Array.from(String(text)).map(c => {
    try { normal.encodeText(c); return c; } catch { return '?'; }
  }).join('');
  const wrap = (text, font, size, maxWidth) => {
    const words = clean(text).split(/\s+/); const lines = []; let line = '';
    for (const word of words) {
      if (font.widthOfTextAtSize((line ? line + ' ' : '') + word, size) > maxWidth && line) {lines.push(line); line = word;}
      else line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line); return lines;
  };
  function newPage(first = false) {
    page = pdf.addPage([W, H]); pageNumber++; column = 0; y = H - M;
    if (first) {
      for (const line of wrap(options.title || 'Devoir de mathématiques', serif, 19, W - 2*M)) {
        page.drawText(line, {x: M, y: y - 19, font: serif, size:19, color:ink}); y -= 25;
      }
      if (options.nameLine) {page.drawText('Nom : ..................................     Prénom : ..................................', {x:M,y:y-19,font:normal,size:10,color:ink});y-=30;}
      y-=10; page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:.6,color:rgb(.7,.73,.7)});y-=20;
    } else {
      const title = clean(options.title || 'Devoir');
      let short = title;
      while (normal.widthOfTextAtSize(short, 8) > W-2*M && short.length) short = short.slice(0,-1);
      page.drawText(short,{x:M,y:H-24,size:8,font:normal,color:rgb(.4,.45,.4)});
      y=H-44;
    }
    top=y;
    page.drawText(String(pageNumber),{x:W-M-8,y:19,size:8,font:normal,color:rgb(.4,.45,.4)});
  }
  function nextColumn() {
    if (column + 1 < columns) {column++;y=top;} else newPage();
  }
  newPage(true);
  for (let index = 0; index < exercises.length; index++) {
    const exercise = exercises[index];progress(index,exercises.length);
    const src = await PDFDocument.load(await loadBytes(exercise.pdf));
    for (let p=0;p<src.getPageCount();p++) {
      let [left,low,right,high] = exercise.bounds[p];
      if (!(right > left && high > low)) throw new Error(`Limites du PDF invalides : ${exercise.id}`);
      const sourceWidth = right-left, sourceHeight=high-low;
      const maxHeight=H-44-bottom-40;
      let scale=Math.min(1,colW/sourceWidth,maxHeight/sourceHeight);
      const drawHeight=sourceHeight*scale;
      const headingHeight=22;
      if (y - headingHeight - drawHeight < bottom) nextColumn();
      // La première page a un en-tête plus haut : passer à la page suivante si nécessaire.
      if (y - headingHeight - drawHeight < bottom) newPage();
      const x=M+column*(colW+gap);
      const label = `Exercice ${index+1}${p>0?' (suite)':''}`;
      page.drawText(label,{x,y:y-11,font:bold,size:10,color:ink}); y-=headingHeight;
      const embedded=await pdf.embedPage(src.getPage(p),{left,bottom:low,right,top:high});
      page.drawPage(embedded,{x,y:y-drawHeight,width:sourceWidth*scale,height:drawHeight});
      y-=drawHeight+20;
      if (p===src.getPageCount()-1) y-=Math.min(120,Math.max(0,Number(options.answerSpace)||0));
    }
  }
  progress(exercises.length,exercises.length);
  return pdf.save();
}
