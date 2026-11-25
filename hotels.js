const HOTEL_DB_NAME='ultradashboard.hotels';
const HOTEL_DB_VERSION=2;
const HOTEL_STORE_NAME='hotels';
const HOTEL_METADATA_STORE_NAME='metadata';
const HOTEL_IMPORT_MARKER_KEY='hotel-workbook-imported';
const SETTINGS_STORAGE_KEY='ultradashboard.settings';
const DEFAULT_HOTEL_RADIUS_KM=10;
const NOMINATIM_REQUEST_INTERVAL_MS=1500;
const MAX_HOTEL_IMPORT_FILE_SIZE=5*1024*1024;
const MAX_IMPORTED_HOTELS=5000;
const DEMO_HOTELS=[
  {
    id:'hotel-thuis',
    name:'Hotel Nieuwerkerk aan den IJssel B.V.',
    address:'Parallelweg - Zuid 185, 2914 LE Nieuwerkerk aan den IJssel',
    phone:'+31 (0)180 32 11 03',
    website:'https://www.hotelnieuwerkerk.nl/contact/',
    extraInfo:'Voor als je direct na de start in slaap valt'
  },
  {
    id:'hotel-eindhoven',
    name:'Hotel Eindhoven',
    address:'Aalsterweg 322, 5644 RL Eindhoven',
    phone:'+31 40 211 60 33',
    website:'https://www.hoteleindhoven.nl/',
    extraInfo:'Eindhoven de gekste'
  },
  {
    id:'hotel-breda',
    name:'Hotel Breda',
    address:'Princenhagelaan 5, 4813 DA Breda',
    phone:'+31 76 522 60 55',
    website:'https://www.vandervalkbreda.com/',
    extraInfo:'Keileuk'
  }
].map(hotel=>({
  ...hotel,
  latitude:null,
  longitude:null,
  geocodedAt:null,
  geocoder:null
}));
let hotelDatabase=null,savedHotels=[],hotelMap=null,hotelMapLayer=null;
let nominatimBusy=false,hotelImportBusy=false,lastNominatimRequestAt=0;
const hotelMessages=new Map();
const $=selector=>document.querySelector(selector);

function openHotelDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(HOTEL_DB_NAME,HOTEL_DB_VERSION);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains(HOTEL_STORE_NAME)) {
        database.createObjectStore(HOTEL_STORE_NAME,{keyPath:'id'});
      }
      if(!database.objectStoreNames.contains(HOTEL_METADATA_STORE_NAME)) {
        database.createObjectStore(HOTEL_METADATA_STORE_NAME,{keyPath:'key'});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('De hotelopslag kon niet worden geopend.'));
    request.onblocked=()=>reject(new Error('De hotelopslag wordt geblokkeerd door een ander browsertabblad.'));
  });
}

function setHotelRadiusStatus(message) {
  $('#hotelRadiusStatus').textContent=message;
}

function loadHotelRadiusSetting() {
  const input=$('#hotelRadiusKm');
  try {
    const raw=localStorage.getItem(SETTINGS_STORAGE_KEY);
    if(!raw) {
      input.value=String(DEFAULT_HOTEL_RADIUS_KM);
      return;
    }
    const settings=JSON.parse(raw);
    if(!settings||typeof settings!=='object'||Array.isArray(settings)) {
      throw new Error('De opgeslagen instellingen zijn ongeldig.');
    }
    const radius=settings.hotelRadiusKm;
    if(radius===undefined) {
      input.value=String(DEFAULT_HOTEL_RADIUS_KM);
    } else if(typeof radius==='number'&&Number.isFinite(radius)&&radius>=0) {
      input.value=String(radius);
    } else {
      input.value=String(DEFAULT_HOTEL_RADIUS_KM);
      setHotelRadiusStatus('De opgeslagen hotelstraal is ongeldig; 10 km wordt gebruikt.');
    }
  } catch(error) {
    console.error('De hotelstraal kon niet uit browseropslag worden gelezen.',error);
    input.value=String(DEFAULT_HOTEL_RADIUS_KM);
    setHotelRadiusStatus('De opgeslagen instellingen konden niet worden gelezen; 10 km wordt gebruikt.');
  }
}

function saveHotelRadiusSetting(event) {
  event.preventDefault();
  const input=$('#hotelRadiusKm');
  if(!input.value.trim()||!input.checkValidity()) {
    setHotelRadiusStatus('Vul een geldige hotelstraal van 0 km of meer in.');
    input.focus();
    return;
  }
  try {
    const raw=localStorage.getItem(SETTINGS_STORAGE_KEY);
    const settings=raw?JSON.parse(raw):{};
    if(!settings||typeof settings!=='object'||Array.isArray(settings)) {
      throw new Error('De opgeslagen instellingen zijn ongeldig.');
    }
    const radius=Number(input.value);
    settings.hotelRadiusKm=radius;
    localStorage.setItem(SETTINGS_STORAGE_KEY,JSON.stringify(settings));
    const formattedRadius=new Intl.NumberFormat('nl-NL',{maximumFractionDigits:1}).format(radius);
    setHotelRadiusStatus(`Zoekstraal opgeslagen: ${formattedRadius} km.`);
  } catch(error) {
    console.error('De hotelstraal kon niet in browseropslag worden opgeslagen.',error);
    setHotelRadiusStatus(error.message||'De hotelstraal kon niet worden opgeslagen.');
  }
}

function readHotel(id) {
  return new Promise((resolve,reject)=>{
    const transaction=hotelDatabase.transaction(HOTEL_STORE_NAME,'readonly');
    const request=transaction.objectStore(HOTEL_STORE_NAME).get(id);
    request.onsuccess=()=>resolve(request.result||null);
    request.onerror=()=>reject(request.error||new Error('Het hotel kon niet uit browseropslag worden gelezen.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Het lezen van het hotel is afgebroken.'));
  });
}

function readAllHotels() {
  return new Promise((resolve,reject)=>{
    const transaction=hotelDatabase.transaction(HOTEL_STORE_NAME,'readonly');
    const request=transaction.objectStore(HOTEL_STORE_NAME).getAll();
    request.onsuccess=()=>resolve(request.result||[]);
    request.onerror=()=>reject(request.error||new Error('De hotels konden niet uit browseropslag worden gelezen.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Het ophalen van de hotels is afgebroken.'));
  });
}

function writeHotel(hotel) {
  return new Promise((resolve,reject)=>{
    const transaction=hotelDatabase.transaction(HOTEL_STORE_NAME,'readwrite');
    transaction.objectStore(HOTEL_STORE_NAME).put(hotel);
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error||new Error('Het hotel kon niet in browseropslag worden opgeslagen.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Het opslaan van het hotel is afgebroken.'));
  });
}

function readHotelImportMarker() {
  return new Promise((resolve,reject)=>{
    const transaction=hotelDatabase.transaction(HOTEL_METADATA_STORE_NAME,'readonly');
    const request=transaction.objectStore(HOTEL_METADATA_STORE_NAME).get(HOTEL_IMPORT_MARKER_KEY);
    request.onsuccess=()=>resolve(Boolean(request.result&&request.result.value));
    request.onerror=()=>reject(request.error||new Error('De importinstellingen konden niet worden gelezen.'));
    transaction.onabort=()=>reject(transaction.error||new Error('Het lezen van de importinstellingen is afgebroken.'));
  });
}

function hasCoordinates(hotel) {
  return Number.isFinite(hotel.latitude)&&Number.isFinite(hotel.longitude)&&
    Math.abs(hotel.latitude)<=90&&Math.abs(hotel.longitude)<=180;
}

function appendValue(element,value,href=null) {
  element.replaceChildren();
  if(href) {
    const link=document.createElement('a');
    link.href=href;
    link.textContent=value;
    if(href.startsWith('http:')||href.startsWith('https:')) {
      link.target='_blank';
      link.rel='noopener noreferrer';
    }
    element.append(link);
  } else {
    element.textContent=value||'—';
  }
}

function hotelField(label,value,href=null,{expandable=false}={}) {
  const row=document.createElement('div');
  const term=document.createElement('dt');
  term.textContent=label;
  const definition=document.createElement('dd');
  if(expandable&&value) {
    const disclosure=document.createElement('details');
    disclosure.className='hotel-extra-info';
    const summary=document.createElement('summary');
    summary.textContent=String(value);
    const fullValue=document.createElement('span');
    fullValue.className='hotel-extra-info-full';
    fullValue.textContent=String(value);
    disclosure.append(summary,fullValue);
    definition.append(disclosure);
  } else {
    appendValue(definition,value,href);
  }
  row.append(term,definition);
  return row;
}

function renderHotels() {
  const list=$('#hotelList');
  list.replaceChildren();
  const missingCoordinates=savedHotels.filter(hotel=>!hasCoordinates(hotel)).length;
  const bulkButton=$('#geocodeAllHotels');
  bulkButton.disabled=nominatimBusy||hotelImportBusy||!hotelDatabase||missingCoordinates===0;
  bulkButton.textContent=missingCoordinates===0?
    'Alle coördinaten zijn al bekend':
    `Alle ontbrekende coördinaten ophalen (${missingCoordinates})`;
  updateHotelControls();
  for(const hotel of savedHotels) {
    const card=document.createElement('article');
    card.className='hotel-record-card';
    const heading=document.createElement('h3');
    heading.textContent=hotel.name||'Hotel zonder naam';
    const details=document.createElement('dl');
    details.className='hotel-record';
    details.append(
      hotelField('Adres',hotel.address),
      hotelField('Telefoon',hotel.phone,HotelMapLayer.safeHotelPhone(hotel.phone)),
      hotelField('Website',hotel.website,HotelMapLayer.safeHotelWebsite(hotel.website)),
      hotelField('Extra info',hotel.extraInfo,null,{expandable:true}),
      hotelField('Coördinaten',hasCoordinates(hotel)?
        `${hotel.latitude.toFixed(5)}, ${hotel.longitude.toFixed(5)}`:'Nog niet opgehaald')
    );
    const button=document.createElement('button');
    button.className='button button-secondary';
    button.type='button';
    button.disabled=nominatimBusy||hotelImportBusy||!hotelDatabase||hasCoordinates(hotel);
    button.textContent='Coördinaten ophalen';
    button.addEventListener('click',()=>geocodeHotel(hotel.id));
    const status=document.createElement('p');
    status.className='hotel-status small';
    status.setAttribute('role','status');
    status.textContent=hotelMessages.get(hotel.id)||
      (hasCoordinates(hotel)?'Coördinaten zijn lokaal opgeslagen.':'');
    card.append(heading,details,button,status);
    list.append(card);
  }
}

function updateHotelControls() {
  const fileInput=$('#hotelWorkbook');
  const importButton=$('#importHotels');
  const exportButton=$('#exportHotels');
  const busy=hotelImportBusy||nominatimBusy||!hotelDatabase;
  fileInput.disabled=busy;
  importButton.disabled=busy||!fileInput.files.length;
  exportButton.disabled=busy||savedHotels.length===0||typeof XLSX==='undefined';
}

function initializeHotelMap() {
  try {
    if(typeof maplibregl==='undefined')throw new Error('De kaartbibliotheek kon niet worden geladen.');
    hotelMap=new maplibregl.Map({
      container:'hotelMap',
      style:'https://tiles.openfreemap.org/styles/liberty',
      center:[4.5,52.1],
      zoom:7
    });
    hotelMap.addControl(new maplibregl.NavigationControl(),'top-right');
    hotelMap.on('load',()=>{
      hotelMapLayer=HotelMapLayer.create(hotelMap,{
        sourceId:'saved-hotels',
        layerId:'saved-hotels-points',
        status:$('#hotelMapStatus')
      });
      hotelMapLayer.setHotels(savedHotels,true);
    });
    hotelMap.on('error',()=>{
      if(!hotelMap.loaded()) {
        $('#hotelMapWarn').textContent='De kaart kon niet worden geladen. Controleer de internetverbinding.';
        $('#hotelMapWarn').style.display='block';
      }
    });
  } catch(error) {
    console.error('De hotelkaart kon niet worden gestart.',error);
    $('#hotelMapWarn').textContent=error.message||'De hotelkaart kon niet worden gestart.';
    $('#hotelMapWarn').style.display='block';
  }
}

async function refreshHotels(fitMap=false) {
  savedHotels=await readAllHotels();
  renderHotels();
  if(hotelMapLayer)hotelMapLayer.setHotels(savedHotels,fitMap);
}

function setHotelStatus(message) {
  $('#hotelStatus').textContent=message;
}

async function initializeDemoHotels() {
  hotelDatabase=await openHotelDatabase();
  if(await readHotelImportMarker()) {
    await refreshHotels();
    return;
  }
  for(const demoHotel of DEMO_HOTELS) {
    const existing=await readHotel(demoHotel.id);
    if(!existing) {
      await writeHotel(demoHotel);
      continue;
    }
    const hasChanged=existing.name!==demoHotel.name||existing.address!==demoHotel.address||
      existing.phone!==demoHotel.phone||existing.website!==demoHotel.website||
      existing.extraInfo!==demoHotel.extraInfo;
    if(!hasChanged)continue;
    const addressChanged=existing.address!==demoHotel.address;
    await writeHotel({
      ...existing,
      ...demoHotel,
      ...(addressChanged?{
        latitude:null,
        longitude:null,
        geocodedAt:null,
        geocoder:null
      }:{
        latitude:existing.latitude,
        longitude:existing.longitude,
        geocodedAt:existing.geocodedAt,
        geocoder:existing.geocoder
      })
    });
  }
  await refreshHotels();
}

function normalizeHeader(value) {
  return String(value??'').normalize('NFKC').trim().toLocaleLowerCase('nl-NL');
}

function normalizeAddress(value) {
  return String(value??'')
    .normalize('NFKC')
    .trim()
    .replace(/[‐‑‒–—―−]/g,'-')
    .replace(/[.,;:]/g,' ')
    .replace(/\s*-\s*/g,'-')
    .replace(/\s+/g,' ')
    .toLocaleLowerCase('nl-NL');
}

function spreadsheetText(value) {
  return value==null?'':String(value).trim();
}

function getHotelImportColumns(headerRow) {
  const headers=headerRow.map(normalizeHeader);
  const findColumn=aliases=>headers.findIndex(header=>aliases.includes(header));
  const columns={
    name:findColumn(['naam hotel','hotelnaam']),
    address:findColumn(['adres']),
    phone:findColumn(['telefoon','telefoonnummer']),
    website:findColumn(['website','link website','link naar website','link naar de website']),
    extraInfo:findColumn(['extra info','extra informatie'])
  };
  if(columns.name<0||columns.address<0) {
    throw new Error('De eerste rij moet de kolommen "Naam hotel" en "Adres" bevatten. Gebruik het demo-Excelbestand als voorbeeld.');
  }
  return columns;
}

async function parseHotelWorkbook(file) {
  if(!file.name.toLocaleLowerCase('nl-NL').endsWith('.xlsx')) {
    throw new Error('Selecteer een Excelbestand met de extensie .xlsx.');
  }
  if(file.size===0||file.size>MAX_HOTEL_IMPORT_FILE_SIZE) {
    throw new Error('Het Excelbestand moet groter zijn dan 0 bytes en maximaal 5 MB zijn.');
  }
  if(typeof XLSX==='undefined') {
    throw new Error('De Excel-parser is niet geladen. Controleer de internetverbinding en probeer het opnieuw.');
  }
  const workbookData=await file.arrayBuffer();
  const signature=new Uint8Array(workbookData,0,Math.min(2,workbookData.byteLength));
  if(signature[0]!==0x50||signature[1]!==0x4b) {
    throw new Error('Het bestand heeft geen geldige .xlsx-indeling.');
  }
  let workbook;
  try {
    workbook=XLSX.read(workbookData,{
      type:'array',
      cellFormula:true,
      cellHTML:false,
      cellStyles:false,
      bookVBA:false,
      sheetRows:MAX_IMPORTED_HOTELS+2
    });
  } catch(error) {
    throw new Error(`Het Excelbestand kon niet worden gelezen: ${error.message||'ongeldige bestandsinhoud'}`);
  }
  const sheetName=workbook.SheetNames[0];
  if(!sheetName)throw new Error('Het Excelbestand bevat geen werkblad.');
  const worksheet=workbook.Sheets[sheetName];
  const hasFormula=Object.keys(worksheet).some(address=>
    !address.startsWith('!')&&worksheet[address]&&worksheet[address].f);
  if(hasFormula)throw new Error('Gebruik in het Excelbestand alleen vaste waarden, geen formules.');
  const rows=XLSX.utils.sheet_to_json(worksheet,{
    header:1,
    defval:'',
    raw:false,
    blankrows:false
  });
  if(rows.length<2)throw new Error('Het werkblad bevat geen hotelgegevens onder de kolomkoppen.');
  if(rows.length-1>MAX_IMPORTED_HOTELS) {
    throw new Error(`Er kunnen maximaal ${MAX_IMPORTED_HOTELS} hotels tegelijk worden geïmporteerd.`);
  }
  const columns=getHotelImportColumns(rows[0]);
  const hotels=[];
  for(let index=1;index<rows.length;index++) {
    const row=rows[index];
    if(row.every(value=>spreadsheetText(value)===''))continue;
    const hotel={
      name:spreadsheetText(row[columns.name]),
      address:spreadsheetText(row[columns.address]),
      phone:columns.phone<0?'':spreadsheetText(row[columns.phone]),
      website:columns.website<0?'':spreadsheetText(row[columns.website]),
      extraInfo:columns.extraInfo<0?'':spreadsheetText(row[columns.extraInfo])
    };
    if(!hotel.name||!hotel.address) {
      throw new Error(`Rij ${index+1}: vul zowel "Naam hotel" als "Adres" in.`);
    }
    hotels.push(hotel);
  }
  if(hotels.length===0)throw new Error('Er zijn geen geldige hotelgegevens gevonden.');
  return hotels;
}

function createImportedHotelId() {
  if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function') {
    return `hotel-${crypto.randomUUID()}`;
  }
  return `hotel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function replaceHotelsWithImport(importedHotels) {
  return new Promise((resolve,reject)=>{
    const transaction=hotelDatabase.transaction(
      [HOTEL_STORE_NAME,HOTEL_METADATA_STORE_NAME],
      'readwrite'
    );
    const hotelStore=transaction.objectStore(HOTEL_STORE_NAME);
    const metadataStore=transaction.objectStore(HOTEL_METADATA_STORE_NAME);
    const request=hotelStore.getAll();
    let importedResult=null,failure=null;
    request.onsuccess=()=>{
      try {
        const existingByAddress=new Map();
        for(const hotel of request.result||[]) {
          const address=normalizeAddress(hotel.address);
          if(address&&hasCoordinates(hotel)&&!existingByAddress.has(address)) {
            existingByAddress.set(address,hotel);
          }
        }
        let preservedCoordinateCount=0;
        const replacementHotels=importedHotels.map(hotel=>{
          const existing=existingByAddress.get(normalizeAddress(hotel.address));
          if(existing)preservedCoordinateCount++;
          return {
            id:createImportedHotelId(),
            ...hotel,
            latitude:existing?existing.latitude:null,
            longitude:existing?existing.longitude:null,
            geocodedAt:existing?existing.geocodedAt:null,
            geocoder:existing?existing.geocoder:null
          };
        });
        hotelStore.clear();
        for(const hotel of replacementHotels)hotelStore.put(hotel);
        metadataStore.put({
          key:HOTEL_IMPORT_MARKER_KEY,
          value:true,
          importedAt:new Date().toISOString()
        });
        importedResult={
          hotelCount:replacementHotels.length,
          preservedCoordinateCount
        };
      } catch(error) {
        failure=error;
        transaction.abort();
      }
    };
    request.onerror=()=>{
      failure=request.error||new Error('De bestaande hotels konden niet worden gelezen.');
      transaction.abort();
    };
    transaction.oncomplete=()=>resolve(importedResult);
    transaction.onerror=()=>reject(failure||transaction.error||new Error('De hotelimport is mislukt.'));
    transaction.onabort=()=>reject(failure||transaction.error||new Error('De hotelimport is afgebroken.'));
  });
}

function setHotelFileStatus(message) {
  $('#hotelFileStatus').textContent=message;
}

function exportHotelsToWorkbook() {
  if(hotelImportBusy||nominatimBusy||!hotelDatabase)return;
  if(savedHotels.length===0) {
    setHotelFileStatus('Er zijn geen opgeslagen hotels om te exporteren.');
    return;
  }
  try {
    if(typeof XLSX==='undefined') {
      throw new Error('De Excel-bibliotheek kon niet worden geladen. Controleer de internetverbinding en probeer het opnieuw.');
    }
    const rows=[
      ['Naam hotel','Adres','Telefoon','Website','Extra info'],
      ...savedHotels.map(hotel=>[
        hotel.name||'',
        hotel.address||'',
        hotel.phone||'',
        hotel.website||'',
        hotel.extraInfo||''
      ])
    ];
    const worksheet=XLSX.utils.aoa_to_sheet(rows);
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,worksheet,'Hotels');
    XLSX.writeFile(workbook,'hotels.xlsx',{bookType:'xlsx'});
    setHotelFileStatus(`${savedHotels.length} hotels geëxporteerd naar hotels.xlsx.`);
  } catch(error) {
    console.error('De hotels konden niet naar Excel worden geëxporteerd.',error);
    setHotelFileStatus(error.message||'De Excel-export is mislukt.');
  }
}

async function importHotelsFromFile() {
  if(hotelImportBusy||nominatimBusy||!hotelDatabase)return;
  const file=$('#hotelWorkbook').files[0];
  if(!file) {
    setHotelFileStatus('Kies eerst een .xlsx-bestand.');
    return;
  }
  hotelImportBusy=true;
  updateHotelControls();
  renderHotels();
  setHotelFileStatus('Het bestand wordt in deze browser gecontroleerd en gelezen…');
  try {
    const importedHotels=await parseHotelWorkbook(file);
    const result=await replaceHotelsWithImport(importedHotels);
    hotelMessages.clear();
    $('#hotelWorkbook').value='';
    await refreshHotels(true);
    setHotelFileStatus(
      `${result.hotelCount} hotels geïmporteerd; ${result.preservedCoordinateCount} bestaande coördinatensets behouden.`
    );
    setHotelStatus('De hotelcollectie is volledig vervangen door de Excel-import.');
  } catch(error) {
    console.error('De hotelimport is mislukt.',error);
    setHotelFileStatus(error.message||'De Excel-import is mislukt. Controleer het bestand en probeer het opnieuw.');
  } finally {
    hotelImportBusy=false;
    updateHotelControls();
    renderHotels();
  }
}

async function waitForNominatimSlot() {
  const delay=Math.max(0,NOMINATIM_REQUEST_INTERVAL_MS-(Date.now()-lastNominatimRequestAt));
  if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
  lastNominatimRequestAt=Date.now();
}

async function requestHotelCoordinates(hotel,fitMap) {
  hotelMessages.set(hotel.id,'Adres wordt naar Nominatim gestuurd voor geocodering…');
  renderHotels();
  try {
    await waitForNominatimSlot();
    const url=new URL('https://nominatim.openstreetmap.org/search');
    url.search=new URLSearchParams({
      format:'jsonv2',
      limit:'1',
      q:hotel.address
    }).toString();
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Nominatim gaf een fout terug (${response.status}).`);
    const results=await response.json();
    if(!Array.isArray(results)||results.length===0) {
      throw new Error('Nominatim vond geen locatie. Controleer het adres en probeer het opnieuw.');
    }
    const longitude=Number(results[0].lon),latitude=Number(results[0].lat);
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90) {
      throw new Error('Nominatim gaf ongeldige coördinaten terug.');
    }
    await writeHotel({
      ...hotel,
      longitude,
      latitude,
      geocodedAt:new Date().toISOString(),
      geocoder:'Nominatim'
    });
    hotelMessages.set(hotel.id,`Coördinaten lokaal opgeslagen: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}.`);
    await refreshHotels(fitMap);
    setHotelStatus(`${hotel.name}: coördinaten lokaal opgeslagen.`);
    return true;
  } catch(error) {
    console.error(`Het adres van ${hotel.name} kon niet met Nominatim worden gegeocodeerd.`,error);
    hotelMessages.set(hotel.id,error.message||'Het adres kon niet worden gegeocodeerd. Controleer de verbinding en probeer het opnieuw.');
    setHotelStatus(hotelMessages.get(hotel.id));
    renderHotels();
    return false;
  }
}

async function geocodeHotel(hotelId) {
  const hotel=savedHotels.find(savedHotel=>savedHotel.id===hotelId);
  if(!hotel||nominatimBusy)return;
  if(hasCoordinates(hotel)) {
    hotelMessages.set(hotel.id,'De coördinaten zijn al opgehaald en worden lokaal bewaard.');
    renderHotels();
    return;
  }
  nominatimBusy=true;
  renderHotels();
  try {
    await requestHotelCoordinates(hotel,true);
  } finally {
    nominatimBusy=false;
    renderHotels();
  }
}

function updateBulkProgress(total,processed,succeeded,failed,currentHotel='') {
  const progress=$('#hotelBulkProgressBar');
  progress.max=Math.max(total,1);
  progress.value=processed;
  const summary=`${processed} van ${total} verwerkt (${succeeded} opgehaald, ${failed} mislukt).`;
  $('#hotelBulkProgressText').textContent=currentHotel?
    `${summary} Bezig met: ${currentHotel}.`:summary;
}

async function geocodeMissingHotels() {
  if(nominatimBusy||!hotelDatabase)return;
  const pendingHotels=savedHotels.filter(hotel=>!hasCoordinates(hotel));
  if(pendingHotels.length===0) {
    setHotelStatus('Alle opgeslagen hotels hebben al geldige coördinaten.');
    return;
  }
  nominatimBusy=true;
  $('#hotelBulkProgress').hidden=false;
  let processed=0,succeeded=0,failed=0;
  updateBulkProgress(pendingHotels.length,processed,succeeded,failed,pendingHotels[0].name);
  renderHotels();
  try {
    for(const hotel of pendingHotels) {
      const success=await requestHotelCoordinates(hotel,false);
      if(success)succeeded++;
      else failed++;
      processed++;
      updateBulkProgress(pendingHotels.length,processed,succeeded,failed,
        processed<pendingHotels.length?pendingHotels[processed].name:'');
    }
    await refreshHotels(true);
    setHotelStatus(`${processed} hotels verwerkt: ${succeeded} coördinaten opgehaald, ${failed} mislukt.`);
  } finally {
    nominatimBusy=false;
    renderHotels();
  }
}

$('#geocodeAllHotels').addEventListener('click',geocodeMissingHotels);
$('#hotelWorkbook').addEventListener('change',updateHotelControls);
$('#importHotels').addEventListener('click',importHotelsFromFile);
$('#exportHotels').addEventListener('click',exportHotelsToWorkbook);
$('#hotelRadiusForm').addEventListener('submit',saveHotelRadiusSetting);
loadHotelRadiusSetting();

initializeDemoHotels().catch(error=>{
  console.error('De demo-hotels konden niet uit IndexedDB worden opgehaald.',error);
  setHotelStatus(error.message||'De hotels konden niet uit de lokale browseropslag worden geladen.');
}).finally(()=>{
  initializeHotelMap();
});
