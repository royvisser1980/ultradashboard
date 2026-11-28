const MAX_IMPORTED_CHECKPOINTS=5000;
const checkpointElement=selector=>document.querySelector(selector);
let checkpointDatabase=null,savedCheckpoints=[],checkpointImportBusy=false,checkpointGeocodingBusy=false;
const checkpointMessages=new Map();

function checkpointImportColumns(headerRow) {
  const headers=headerRow.map(SpreadsheetUtils.normalizeHeader);
  const find=aliases=>headers.findIndex(header=>aliases.includes(header));
  const columns={
    name:find(['naam checkpoint','checkpointnaam','checkpoint','naam']),
    address:find(['adres']),
    latitude:find(['latitude','breedtegraad','lat']),
    longitude:find(['longitude','lengtegraad','lon','lng']),
    cutoff:find(['cut-off','cut off','cut-off time','cut off time','cutoff','cutoff time']),
    extraInfo:find(['extra info','extra informatie'])
  };
  if(columns.name<0)throw new Error('De eerste rij moet de kolom "Naam checkpoint" bevatten.');
  if((columns.latitude<0)!==(columns.longitude<0)) {
    throw new Error('Gebruik de kolommen "Latitude" en "Longitude" samen, of laat beide weg.');
  }
  if(columns.address<0&&columns.latitude<0) {
    throw new Error('Voeg de kolom "Adres" en/of de kolommen "Latitude" en "Longitude" toe.');
  }
  return columns;
}

async function parseCheckpointWorkbook(file) {
  const rows=await SpreadsheetUtils.readRows(file,MAX_IMPORTED_CHECKPOINTS,'checkpoints');
  const columns=checkpointImportColumns(rows[0]);
  const text=SpreadsheetUtils.text;
  const checkpoints=[];
  for(let index=1;index<rows.length;index++) {
    const row=rows[index];
    if(row.every(value=>text(value)===''))continue;
    const name=text(row[columns.name]);
    const address=columns.address<0?'':text(row[columns.address]);
    const latitudeText=columns.latitude<0?'':text(row[columns.latitude]);
    const longitudeText=columns.longitude<0?'':text(row[columns.longitude]);
    if(!name)throw new Error(`Rij ${index+1}: vul "Naam checkpoint" in.`);
    if(Boolean(latitudeText)!==Boolean(longitudeText)) {
      throw new Error(`Rij ${index+1}: vul Latitude en Longitude beide in of laat ze allebei leeg.`);
    }
    const latitude=latitudeText?SpreadsheetUtils.parseCoordinate(latitudeText,'Latitude',-90,90,index+1):null;
    const longitude=longitudeText?SpreadsheetUtils.parseCoordinate(longitudeText,'Longitude',-180,180,index+1):null;
    if(!address&&latitude===null) {
      throw new Error(`Rij ${index+1}: vul een adres en/of beide coördinaten in.`);
    }
    checkpoints.push({
      name,address,latitude,longitude,
      cutoff:columns.cutoff<0?'':text(row[columns.cutoff]),
      extraInfo:columns.extraInfo<0?'':text(row[columns.extraInfo])
    });
  }
  if(checkpoints.length===0)throw new Error('Er zijn geen geldige checkpoints gevonden.');
  return checkpoints;
}

function updateCheckpointControls() {
  const disabled=checkpointImportBusy||checkpointGeocodingBusy||!checkpointDatabase;
  checkpointElement('#checkpointWorkbook').disabled=disabled;
  checkpointElement('#importCheckpoints').disabled=disabled||!checkpointElement('#checkpointWorkbook').files.length;
  checkpointElement('#exportCheckpoints').disabled=disabled;
}

function renderCheckpoints() {
  const list=checkpointElement('#checkpointList');
  list.replaceChildren();
  const pending=savedCheckpoints.filter(checkpoint=>
    !AccommodationData.hasCoordinates(checkpoint)&&checkpoint.address&&checkpoint.address.trim()).length;
  const bulkButton=checkpointElement('#geocodeAllCheckpoints');
  bulkButton.disabled=checkpointImportBusy||checkpointGeocodingBusy||!checkpointDatabase||pending===0;
  bulkButton.textContent=pending?
    `Alle ontbrekende coördinaten ophalen (${pending})`:
    'Geen ontbrekende coördinaten met adres';
  updateCheckpointControls();
  checkpointElement('#checkpointStatus').textContent=savedCheckpoints.length?
    `${savedCheckpoints.length} checkpoints opgeslagen in deze browser.`:
    'Er zijn nog geen checkpoints geïmporteerd.';
  for(const [index,checkpoint] of savedCheckpoints.entries()) {
    const article=document.createElement('article');
    article.className='hotel-record-card';
    const heading=document.createElement('h3');
    heading.textContent=checkpoint.name;
    const details=document.createElement('dl');
    details.className='hotel-record';
    const addDetail=(label,value)=>{
      if(!value)return;
      const wrapper=document.createElement('div');
      const term=document.createElement('dt');
      const description=document.createElement('dd');
      term.textContent=label;
      description.textContent=value;
      wrapper.append(term,description);
      details.append(wrapper);
    };
    addDetail('Adres',checkpoint.address);
    if(AccommodationData.hasCoordinates(checkpoint)) {
      addDetail('Coördinaten',`${checkpoint.latitude}, ${checkpoint.longitude}`);
    } else {
      addDetail('Coördinaten','Nog niet opgehaald');
    }
    addDetail('Cut-off',checkpoint.cutoff);
    addDetail('Extra info',checkpoint.extraInfo);
    const button=document.createElement('button');
    button.className='button button-secondary';
    button.type='button';
    button.disabled=checkpointImportBusy||checkpointGeocodingBusy||!checkpointDatabase||
      AccommodationData.hasCoordinates(checkpoint)||!checkpoint.address||!checkpoint.address.trim();
    button.textContent='Coördinaten ophalen';
    button.addEventListener('click',()=>geocodeCheckpoint(index));
    article.append(heading,details,button);
    const message=checkpointMessages.get(index);
    if(message) {
      const status=document.createElement('p');
      status.className='hotel-status small';
      status.setAttribute('role','status');
      status.textContent=message;
      article.append(status);
    }
    list.append(article);
  }
}

async function importCheckpointsFromFile() {
  if(checkpointImportBusy||checkpointGeocodingBusy||!checkpointDatabase)return;
  const file=checkpointElement('#checkpointWorkbook').files[0];
  if(!file) {
    checkpointElement('#checkpointFileStatus').textContent='Kies eerst een .xlsx-bestand.';
    return;
  }
  checkpointImportBusy=true;
  renderCheckpoints();
  checkpointElement('#checkpointFileStatus').textContent='Het bestand wordt gecontroleerd en gelezen…';
  try {
    const checkpoints=await parseCheckpointWorkbook(file);
    const result=await CheckpointData.replaceImported(checkpointDatabase,checkpoints);
    savedCheckpoints=result.checkpoints;
    checkpointMessages.clear();
    checkpointElement('#checkpointGeocodeStatus').textContent='';
    checkpointElement('#checkpointBulkProgress').hidden=true;
    checkpointElement('#checkpointWorkbook').value='';
    renderCheckpoints();
    checkpointElement('#checkpointFileStatus').textContent=
      `${checkpoints.length} checkpoints geïmporteerd; ${result.importedCoordinateCount} coördinatensets uit Excel overgenomen en ${result.preservedCoordinateCount} bestaande sets op adres behouden.`;
  } catch(error) {
    console.error('De import van checkpoints is mislukt.',error);
    checkpointElement('#checkpointFileStatus').textContent=
      error.message||'De Excel-import is mislukt. Controleer het bestand en probeer het opnieuw.';
  } finally {
    checkpointImportBusy=false;
    renderCheckpoints();
  }
}

function exportCheckpointsToWorkbook() {
  if(checkpointImportBusy||checkpointGeocodingBusy||!checkpointDatabase)return;
  try {
    if(typeof XLSX==='undefined') {
      throw new Error('De Excel-bibliotheek kon niet worden geladen. Controleer de internetverbinding en probeer het opnieuw.');
    }
    const rows=[
      ['Naam checkpoint','Adres','Latitude','Longitude','Cut-off','Extra info'],
      ...savedCheckpoints.map(checkpoint=>[
        checkpoint.name,checkpoint.address,
        checkpoint.latitude===null?'':checkpoint.latitude,
        checkpoint.longitude===null?'':checkpoint.longitude,
        checkpoint.cutoff,checkpoint.extraInfo
      ])
    ];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'Checkpoints');
    XLSX.writeFile(workbook,'checkpoints.xlsx',{bookType:'xlsx'});
    checkpointElement('#checkpointFileStatus').textContent=savedCheckpoints.length?
      `${savedCheckpoints.length} checkpoints geëxporteerd naar checkpoints.xlsx.`:
      'Leeg Excel-template geëxporteerd naar checkpoints.xlsx.';
  } catch(error) {
    console.error('De checkpoints konden niet naar Excel worden geëxporteerd.',error);
    checkpointElement('#checkpointFileStatus').textContent=error.message||'De Excel-export is mislukt.';
  }
}

async function requestCheckpointCoordinates(index,expected) {
  checkpointMessages.set(index,'Het adres wordt gecontroleerd…');
  renderCheckpoints();
  try {
    const current=await CheckpointData.readAll(checkpointDatabase);
    const checkpoint=current[index];
    if(!checkpoint||checkpoint.name!==expected.name||checkpoint.address!==expected.address) {
      throw new Error('De checkpointlijst is ondertussen gewijzigd. Vernieuw de pagina en probeer opnieuw.');
    }
    if(AccommodationData.hasCoordinates(checkpoint)) {
      savedCheckpoints=current;
      checkpointMessages.set(index,'De coördinaten zijn al lokaal opgeslagen.');
      renderCheckpoints();
      return 'cached';
    }
    const address=Geocoding.normalizeAddress(checkpoint.address);
    const cached=current.find(other=>other!==checkpoint&&
      Geocoding.normalizeAddress(other.address)===address&&AccommodationData.hasCoordinates(other));
    let coordinates;
    if(cached) {
      coordinates={
        latitude:cached.latitude,longitude:cached.longitude,
        geocodedAt:cached.geocodedAt||null,geocoder:cached.geocoder||null
      };
    } else {
      checkpointMessages.set(index,'Adres wordt naar Nominatim gestuurd voor geocodering…');
      renderCheckpoints();
      const location=await Geocoding.search(checkpoint.address);
      coordinates={...location,geocodedAt:new Date().toISOString(),geocoder:'Nominatim'};
    }
    await CheckpointData.setCoordinates(checkpointDatabase,index,checkpoint,coordinates);
    savedCheckpoints=await CheckpointData.readAll(checkpointDatabase);
    checkpointMessages.set(index,cached?'Coördinaten van hetzelfde adres lokaal hergebruikt.':
      'Coördinaten lokaal opgeslagen.');
    renderCheckpoints();
    return cached?'cached':'retrieved';
  } catch(error) {
    console.error(`Het adres van ${expected.name} kon niet worden gegeocodeerd.`,error);
    checkpointMessages.set(index,error.message||'Het adres kon niet worden gegeocodeerd. Controleer de verbinding en probeer het opnieuw.');
    renderCheckpoints();
    return 'failed';
  }
}

async function geocodeCheckpoint(index) {
  const checkpoint=savedCheckpoints[index];
  if(!checkpoint||checkpointGeocodingBusy||checkpointImportBusy||!checkpointDatabase||
     AccommodationData.hasCoordinates(checkpoint)||!checkpoint.address||!checkpoint.address.trim())return;
  checkpointGeocodingBusy=true;
  renderCheckpoints();
  try {
    await requestCheckpointCoordinates(index,checkpoint);
    checkpointElement('#checkpointGeocodeStatus').textContent=`${checkpoint.name}: ${checkpointMessages.get(index)}`;
  } finally {
    checkpointGeocodingBusy=false;
    renderCheckpoints();
  }
}

function updateCheckpointBulkProgress(total,processed,retrieved,cached,failed,current='') {
  const progress=checkpointElement('#checkpointBulkProgressBar');
  progress.max=Math.max(total,1);
  progress.value=processed;
  const summary=`${processed} van ${total} verwerkt (${retrieved} opgehaald, ${cached} hergebruikt, ${failed} mislukt).`;
  checkpointElement('#checkpointBulkProgressText').textContent=current?
    `${summary} Bezig met: ${current}.`:summary;
}

async function geocodeMissingCheckpoints() {
  if(checkpointGeocodingBusy||checkpointImportBusy||!checkpointDatabase)return;
  const pending=savedCheckpoints.map((checkpoint,index)=>({checkpoint,index})).filter(item=>
    !AccommodationData.hasCoordinates(item.checkpoint)&&item.checkpoint.address&&item.checkpoint.address.trim());
  if(!pending.length)return;
  checkpointGeocodingBusy=true;
  checkpointElement('#checkpointBulkProgress').hidden=false;
  let processed=0,retrieved=0,cached=0,failed=0;
  updateCheckpointBulkProgress(pending.length,processed,retrieved,cached,failed,pending[0].checkpoint.name);
  renderCheckpoints();
  try {
    for(const item of pending) {
      const result=await requestCheckpointCoordinates(item.index,item.checkpoint);
      if(result==='retrieved')retrieved++;
      else if(result==='cached')cached++;
      else failed++;
      processed++;
      updateCheckpointBulkProgress(pending.length,processed,retrieved,cached,failed,
        processed<pending.length?pending[processed].checkpoint.name:'');
    }
    checkpointElement('#checkpointGeocodeStatus').textContent=
      `${processed} checkpoints verwerkt: ${retrieved} opgehaald, ${cached} hergebruikt, ${failed} mislukt.`;
  } finally {
    checkpointGeocodingBusy=false;
    renderCheckpoints();
  }
}

async function initializeCheckpoints() {
  checkpointElement('#checkpointWorkbook').addEventListener('change',updateCheckpointControls);
  checkpointElement('#importCheckpoints').addEventListener('click',importCheckpointsFromFile);
  checkpointElement('#exportCheckpoints').addEventListener('click',exportCheckpointsToWorkbook);
  checkpointElement('#geocodeAllCheckpoints').addEventListener('click',geocodeMissingCheckpoints);
  try {
    checkpointDatabase=await CheckpointData.openDatabase();
    savedCheckpoints=await CheckpointData.readAll(checkpointDatabase);
    renderCheckpoints();
    updateCheckpointControls();
  } catch(error) {
    checkpointDatabase=null;
    console.error('De checkpointopslag kon niet worden geladen.',error);
    checkpointElement('#checkpointStatus').textContent=error.message||'De checkpointopslag kon niet worden geladen.';
  }
}

initializeCheckpoints();
