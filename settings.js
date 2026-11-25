const form=document.querySelector('#settingsForm');
const startInput=document.querySelector('#startDate');
const scenarioContainer=document.querySelector('#scenarioSettings');
const status=document.querySelector('#settingsStatus');
const saveButton=document.querySelector('#saveSettings');
const setStatus=message=>{status.textContent=message};
const addScenarioButton=document.querySelector('#addScenario');
let routeTotalKm=0;
let settingsReady=false;
let scenarios=[];
let nextScenarioId=1;
let nextScenarioContentId=1;

function createField(labelText,type,value,fieldName,options={}) {
  const label=document.createElement('label');
  label.className='settings-field';
  const caption=document.createElement('span');
  caption.textContent=labelText;
  const input=document.createElement('input');
  input.type=type;
  input.value=value===undefined||value===null?'':String(value);
  input.required=true;
  input.dataset.field=fieldName;
  if(options.min!==undefined)input.min=String(options.min);
  if(options.max!==undefined)input.max=String(options.max);
  if(options.maxLength!==undefined)input.maxLength=options.maxLength;
  if(options.step!==undefined)input.step=String(options.step);
  if(options.readOnly)input.readOnly=true;
  label.append(caption,input);
  return {label,input};
}

function updateZoneBounds(zoneList) {
  const rows=[...zoneList.querySelectorAll('.speed-zone')];
  let previousTo=0;
  rows.forEach((row,index)=>{
    const fromInput=row.querySelector('[data-field="zoneFrom"]');
    const toInput=row.querySelector('[data-field="zoneTo"]');
    fromInput.value=String(index===0?0:previousTo);
    fromInput.readOnly=true;
    const isLast=index===rows.length-1;
    toInput.readOnly=isLast;
    if(isLast)toInput.value=String(routeTotalKm);
    previousTo=Number(toInput.value);
    const remove=row.querySelector('.zone-remove');
    remove.disabled=rows.length===1;
    remove.setAttribute('aria-label',`Verwijder kilometervak ${index+1}`);
  });
}

function zoneRow(zone,index,zoneList) {
  const row=document.createElement('div');
  row.className='speed-zone';
  const fromField=createField('Vanaf km','number',zone.fromKm,'zoneFrom',{min:0,max:routeTotalKm,step:0.001,readOnly:true});
  const toField=createField('Tot km','number',zone.toKm===null?routeTotalKm:zone.toKm,'zoneTo',{min:0,max:routeTotalKm,step:0.001});
  toField.input.addEventListener('input',()=>{
    updateZoneBounds(zoneList);
    setStatus('');
  });
  row.append(
    fromField.label,
    toField.label,
    createField('Snelheid (km/u)','number',zone.kmPerHour,'zoneSpeed',{min:0.1,step:0.1}).label
  );
  const remove=document.createElement('button');
  remove.type='button';
  remove.className='button button-secondary zone-remove';
  remove.textContent='Verwijder';
  remove.setAttribute('aria-label',`Verwijder kilometervak ${index+1}`);
  remove.addEventListener('click',()=>{
    const rows=[...zoneList.querySelectorAll('.speed-zone')];
    const rowIndex=rows.indexOf(row);
    if(rows.length<=1)return;
    if(rowIndex>0) {
      rows[rowIndex-1].querySelector('[data-field="zoneTo"]').value=
        row.querySelector('[data-field="zoneTo"]').value;
    } else if(rows.length>1) {
      rows[1].querySelector('[data-field="zoneFrom"]').value=
        row.querySelector('[data-field="zoneFrom"]').value;
    }
    row.remove();
    updateZoneBounds(zoneList);
    setStatus('');
    updateFinishPreviews();
  });
  row.append(remove);
  return row;
}

function renderScenario(scenario) {
  const config=scenario.config;
  const card=document.createElement('section');
  card.className='card scenario scenario-settings';
  card.dataset.scenario=scenario.id;
  scenario.card=card;
  card.style.setProperty('--scenario-color',scenario.color);
  card.classList.add('is-collapsed');
  const content=document.createElement('div');
  content.id=`scenario-settings-content-${nextScenarioContentId++}`;
  content.className='scenario-settings-content';
  content.hidden=true;
  const headingRow=document.createElement('div');
  headingRow.className='scenario-settings-heading';
  const heading=document.createElement('h2');
  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='scenario-toggle';
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-controls',content.id);
  const headingText=document.createElement('span');
  headingText.className='scenario-toggle-title';
  headingText.textContent=scenario.name;
  const toggleIcon=document.createElement('span');
  toggleIcon.className='scenario-toggle-icon';
  toggleIcon.setAttribute('aria-hidden','true');
  toggleIcon.textContent='▾';
  toggle.append(headingText,toggleIcon);
  toggle.addEventListener('click',()=>{
    const expanded=toggle.getAttribute('aria-expanded')!=='true';
    toggle.setAttribute('aria-expanded',String(expanded));
    content.hidden=!expanded;
    card.classList.toggle('is-collapsed',!expanded);
  });
  heading.append(toggle);
  const actions=document.createElement('div');
  actions.className='scenario-actions';
  const moveUp=document.createElement('button');
  moveUp.type='button';
  moveUp.className='button button-secondary scenario-move scenario-move-up';
  moveUp.textContent='↑';
  moveUp.title='Verplaats omhoog';
  moveUp.setAttribute('aria-label',`Verplaats ${scenario.name} omhoog`);
  moveUp.addEventListener('click',()=>moveScenario(scenario,-1));
  const moveDown=document.createElement('button');
  moveDown.type='button';
  moveDown.className='button button-secondary scenario-move scenario-move-down';
  moveDown.textContent='↓';
  moveDown.title='Verplaats omlaag';
  moveDown.setAttribute('aria-label',`Verplaats ${scenario.name} omlaag`);
  moveDown.addEventListener('click',()=>moveScenario(scenario,1));
  const removeScenario=document.createElement('button');
  removeScenario.type='button';
  removeScenario.className='button button-secondary';
  removeScenario.textContent='Schema verwijderen';
  removeScenario.setAttribute('aria-label',`Verwijder schema ${scenario.name}`);
  removeScenario.addEventListener('click',()=>{
    if(scenarios.length<=1)return;
    scenarios=scenarios.filter(item=>item!==scenario);
    card.remove();
    updateScenarioButtons();
    setStatus('');
    updateFinishPreviews();
  });
  actions.append(moveUp,moveDown,removeScenario);
  headingRow.append(heading,actions);
  card.append(headingRow);
  card.append(content);

  const fields=document.createElement('div');
  fields.className='settings-fields';
  fields.append(
    createField('Naam schema','text',scenario.name,'scenarioName',{maxLength:60}).label,
    createField('Kleur schema','color',scenario.color,'scenarioColor').label,
    createField('Korte stop na (rij-uren)','number',config.shortBreak.rideHours,'shortRideHours',{min:0.25,max:24,step:0.25}).label,
    createField('Duur korte stop (minuten)','number',config.shortBreak.minutes,'shortMinutes',{min:1,max:1439,step:1}).label,
    createField('Avondstop om','time',`${String(config.mealBreak.hour).padStart(2,'0')}:${String(config.mealBreak.minute).padStart(2,'0')}`,'mealTime',{step:60}).label,
    createField('Duur avondstop (minuten)','number',config.mealBreak.minutes,'mealMinutes',{min:1,max:1439,step:1}).label,
    createField('Slaapstop begint om','time',`${String(config.sleepBreak.startHour).padStart(2,'0')}:${String(config.sleepBreak.startMinute||0).padStart(2,'0')}`,'sleepTime',{step:60}).label,
    createField('Duur slaapstop (minuten)','number',config.sleepBreak.minutes,'sleepMinutes',{min:1,max:1439,step:1}).label,
    createField('Geen slaapstop meer als nog (km) resteert','number',config.sleepBreak.minimumRemainingKm,'sleepMinimumRemainingKm',{min:0,max:routeTotalKm,step:0.1}).label
  );
  fields.querySelector('[data-field="scenarioName"]').addEventListener('input',event=>{
    scenario.name=event.target.value.trim();
    headingText.textContent=scenario.name||'Naamloos schema';
    removeScenario.setAttribute('aria-label',`Verwijder schema ${scenario.name||'Naamloos schema'}`);
    moveUp.setAttribute('aria-label',`Verplaats ${scenario.name||'Naamloos schema'} omhoog`);
    moveDown.setAttribute('aria-label',`Verplaats ${scenario.name||'Naamloos schema'} omlaag`);
  });
  fields.querySelector('[data-field="scenarioColor"]').addEventListener('input',event=>{
    card.style.setProperty('--scenario-color',event.target.value);
    scenario.color=event.target.value;
  });
  content.append(fields);

  const zoneHeading=document.createElement('h3');
  zoneHeading.textContent='Snelheid per kilometervak';
  content.append(zoneHeading);
  const help=document.createElement('p');
  help.className='settings-help';
  help.textContent=`De vakken moeten aansluiten van 0 tot ${routeTotalKm.toFixed(3)} km, zonder overlap of gaten.`;
  content.append(help);
  const zoneList=document.createElement('div');
  zoneList.className='speed-zone-list';
  config.speedZones.forEach((zone,index)=>zoneList.append(zoneRow(zone,index,zoneList)));
  updateZoneBounds(zoneList);
  content.append(zoneList);

  const addButton=document.createElement('button');
  addButton.type='button';
  addButton.className='button button-secondary add-zone';
  addButton.textContent='Kilometervak toevoegen';
  addButton.addEventListener('click',()=>{
    const rows=[...zoneList.querySelectorAll('.speed-zone')];
    const last=rows[rows.length-1];
    const from=Number(last.querySelector('[data-field="zoneFrom"]').value);
    const to=Number(last.querySelector('[data-field="zoneTo"]').value);
    const speed=Number(last.querySelector('[data-field="zoneSpeed"]').value);
    const split=Math.round(((from+to)/2)*1000)/1000;
    if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(speed)||split<=from||split>=to) {
      setStatus(`${scenario.name}: het laatste kilometervak is te klein of ongeldig om te splitsen.`);
      return;
    }
    last.querySelector('[data-field="zoneTo"]').value=String(split);
    zoneList.append(zoneRow({fromKm:split,toKm:to,kmPerHour:speed},rows.length,zoneList));
    updateZoneBounds(zoneList);
    setStatus('');
    updateFinishPreviews();
  });
  content.append(addButton);
  const finishPreview=document.createElement('div');
  finishPreview.className='finish-preview';
  const finishLabel=document.createElement('span');
  finishLabel.textContent='Verwachte finishtijd';
  const finishValue=document.createElement('strong');
  finishValue.dataset.finishTime='';
  finishValue.textContent='Wordt berekend...';
  finishPreview.append(finishLabel,finishValue);
  content.append(finishPreview);
  return card;
}

function updateScenarioButtons() {
  scenarios.forEach((scenario,index)=>{
    const actions=scenario.card.querySelector('.scenario-actions');
    actions.querySelector('.scenario-move-up').disabled=index===0;
    actions.querySelector('.scenario-move-down').disabled=index===scenarios.length-1;
    actions.querySelector('[aria-label^="Verwijder schema"]').disabled=scenarios.length===1;
  });
}

function moveScenario(scenario,direction) {
  const from=scenarios.indexOf(scenario);
  const to=from+direction;
  if(from<0||to<0||to>=scenarios.length)return;
  scenarios.splice(from,1);
  scenarios.splice(to,0,scenario);
  scenarios.forEach(item=>scenarioContainer.append(item.card));
  updateScenarioButtons();
}

function addScenario() {
  if(!settingsReady)return;
  const source=scenarios[0];
  const current=readScenarioConfig(source);
  const config=current.config||source.config;
  const scenario={
    id:`scenario-${nextScenarioId++}`,
    name:`Schema ${scenarios.length+1}`,
    color:'#0f766e',
    config:JSON.parse(JSON.stringify(config))
  };
  scenarios.push(scenario);
  scenarioContainer.append(renderScenario(scenario));
  updateScenarioButtons();
  setStatus('');
  updateFinishPreviews();
}

function isScenarioConfig(config) {
  return DashboardCommon.hasSpeedZones(config)&&
    config.speedZones.every(zone=>zone&&Number.isFinite(Number(zone.fromKm))&&
      (zone.toKm===null||Number.isFinite(Number(zone.toKm)))&&Number.isFinite(Number(zone.kmPerHour)))&&
    config.shortBreak&&Number.isFinite(Number(config.shortBreak.rideHours))&&Number.isFinite(Number(config.shortBreak.minutes))&&
    config.mealBreak&&Number.isFinite(Number(config.mealBreak.hour))&&Number.isFinite(Number(config.mealBreak.minute))&&Number.isFinite(Number(config.mealBreak.minutes))&&
    config.sleepBreak&&Number.isFinite(Number(config.sleepBreak.startHour))&&
    Number.isFinite(Number(config.sleepBreak.startMinute||0))&&Number.isFinite(Number(config.sleepBreak.minutes))&&
    Number.isFinite(Number(config.sleepBreak.minimumRemainingKm));
}

function readSavedSettings() {
  try {
    const raw=localStorage.getItem(DashboardCommon.SETTINGS_STORAGE_KEY);
    if(raw) {
      const saved=JSON.parse(raw);
      if(!saved||typeof saved!=='object')throw new Error('Opgeslagen schema-instellingen zijn ongeldig.');
      return saved;
    }
    const legacyStart=localStorage.getItem(DashboardCommon.LEGACY_START_STORAGE_KEY);
    return legacyStart?{start:legacyStart}:null;
  } catch(error) {
    console.error(error);
    setStatus('De opgeslagen instellingen konden niet worden gelezen. Standaardwaarden worden getoond.');
    return null;
  }
}

function parseClock(value) {
  const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match?{hour:Number(match[1]),minute:Number(match[2])}:null;
}

function numberFrom(card,field) {
  const input=card.querySelector(`[data-field="${field}"]`);
  return input.value.trim()===''?NaN:Number(input.value);
}

function readScenarioConfig(scenario) {
  const card=scenario.card;
  const label=card.querySelector('[data-field="scenarioName"]').value.trim()||'Naamloos schema';
  const name=card.querySelector('[data-field="scenarioName"]').value.trim();
  const color=card.querySelector('[data-field="scenarioColor"]').value;
  if(!name||name.length>60)return {error:'Geef ieder schema een naam van maximaal 60 tekens.'};
  const matchingNames=scenarios.filter(item=>
    item!==scenario&&item.card.querySelector('[data-field="scenarioName"]').value.trim().toLocaleLowerCase()===name.toLocaleLowerCase()
  );
  if(matchingNames.length)return {error:`De naam "${name}" wordt al door een ander schema gebruikt.`};
  if(!/^#[0-9a-f]{6}$/i.test(color))return {error:`${label}: kies een geldige schema-kleur.`};
  const zoneRows=[...card.querySelectorAll('.speed-zone')];
  if(!zoneRows.length)return {error:`${label}: voeg ten minste één kilometervak toe.`};
  const zones=[];
  let previousTo=0;
  for(let index=0;index<zoneRows.length;index++) {
    const row=zoneRows[index];
    let from=numberFrom(row,'zoneFrom');
    let to=numberFrom(row,'zoneTo');
    const speed=numberFrom(row,'zoneSpeed');
    if(!Number.isFinite(from)||!Number.isFinite(to)||!Number.isFinite(speed)||speed<=0) {
      return {error:`${label}: vul voor ieder kilometervak geldige grenzen en een snelheid groter dan 0 in.`};
    }
    if(from<0||to>routeTotalKm+1e-6||to<=from) {
      return {error:`${label}: kilometervak ${index+1} heeft ongeldige grenzen.`};
    }
    if(index===0&&Math.abs(from)>1e-6) {
      return {error:`${label}: het eerste kilometervak moet bij 0 km beginnen.`};
    }
    if(index>0&&from<previousTo-1e-6) {
      return {error:`${label}: kilometervak ${index+1} overlapt met het vorige vak.`};
    }
    if(index>0&&from>previousTo+1e-6) {
      return {error:`${label}: er zit een gat tussen kilometervak ${index} en ${index+1}.`};
    }
    if(index===0)from=0;
    else from=previousTo;
    if(Math.abs(to-routeTotalKm)<=1e-6)to=routeTotalKm;
    zones.push({fromKm:from,toKm:to,kmPerHour:speed});
    previousTo=to;
  }
  if(Math.abs(previousTo-routeTotalKm)>1e-6) {
    return {error:`${label}: de kilometervakken moeten doorlopen tot ${routeTotalKm.toFixed(3)} km.`};
  }

  const shortRideHours=numberFrom(card,'shortRideHours');
  const shortMinutes=numberFrom(card,'shortMinutes');
  const mealTime=parseClock(card.querySelector('[data-field="mealTime"]').value);
  const mealMinutes=numberFrom(card,'mealMinutes');
  const sleepTime=parseClock(card.querySelector('[data-field="sleepTime"]').value);
  const sleepMinutes=numberFrom(card,'sleepMinutes');
  const sleepMinimumRemainingKm=numberFrom(card,'sleepMinimumRemainingKm');
  if(!Number.isFinite(shortRideHours)||shortRideHours<=0||shortRideHours>24) {
    return {error:`${label}: de tijd tussen korte stops moet groter zijn dan 0 en maximaal 24 uur zijn.`};
  }
  if(!Number.isInteger(shortMinutes)||shortMinutes<1||shortMinutes>1439) {
    return {error:`${label}: de duur van een korte stop moet tussen 1 en 1439 minuten liggen.`};
  }
  if(!mealTime||!Number.isInteger(mealMinutes)||mealMinutes<1||mealMinutes>1439) {
    return {error:`${label}: vul een geldig tijdstip en een duur van 1 tot 1439 minuten in voor de avondstop.`};
  }
  if(!sleepTime||!Number.isInteger(sleepMinutes)||sleepMinutes<1||sleepMinutes>1439) {
    return {error:`${label}: vul een geldig tijdstip en een duur van 1 tot 1439 minuten in voor de slaapstop.`};
  }
  if(!Number.isFinite(sleepMinimumRemainingKm)||sleepMinimumRemainingKm<0||sleepMinimumRemainingKm>routeTotalKm) {
    return {error:`${label}: de afstandsdrempel voor de laatste slaapstop moet tussen 0 en ${routeTotalKm.toFixed(3)} km liggen.`};
  }

  return {config:{
    ...scenario.config,
    speedZones:zones,
    shortBreak:{...scenario.config.shortBreak,rideHours:shortRideHours,minutes:shortMinutes},
    mealBreak:{...scenario.config.mealBreak,hour:mealTime.hour,minute:mealTime.minute,minutes:mealMinutes},
    sleepBreak:{
      ...scenario.config.sleepBreak,
      startHour:sleepTime.hour,
      startMinute:sleepTime.minute,
      minutes:sleepMinutes,
      minimumRemainingKm:sleepMinimumRemainingKm
    }
  },name,color};
}

function updateFinishPreviews() {
  if(!settingsReady)return;
  if(!startInput.value||Number.isNaN(new Date(startInput.value).getTime())) {
    scenarios.forEach(scenario=>{
      const output=scenario.card.querySelector('[data-finish-time]');
      output.textContent='Vul een geldige starttijd in.';
      output.classList.add('is-invalid');
    });
    return;
  }
  for(const scenario of scenarios) {
    const output=scenario.card.querySelector('[data-finish-time]');
    const result=readScenarioConfig(scenario);
    if(result.error) {
      output.textContent=`Niet berekend: ${result.error}`;
      output.classList.add('is-invalid');
      continue;
    }
    try {
      const schedule=buildSchedule(result.config,`${startInput.value}:00`,routeTotalKm);
      const finish=new Date(schedule.finish);
      if(Number.isNaN(finish.getTime()))throw new Error('De finishtijd is ongeldig.');
      output.textContent=new Intl.DateTimeFormat('nl-NL',{
        weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'
      }).format(finish);
      output.classList.remove('is-invalid');
    } catch(error) {
      console.error(error);
      output.textContent='Kon de finishtijd niet berekenen.';
      output.classList.add('is-invalid');
    }
  }
}

form.addEventListener('input',updateFinishPreviews);
form.addEventListener('change',updateFinishPreviews);
addScenarioButton.addEventListener('click',addScenario);

form.addEventListener('submit',event=>{
  event.preventDefault();
  if(!settingsReady)return;
  if(!startInput.value||Number.isNaN(new Date(startInput.value).getTime())) {
    setStatus('Vul een geldige startdatum en -tijd in.');
    startInput.focus();
    return;
  }
  const previousSettings=readSavedSettings();
  const saved={start:`${startInput.value}:00`,scenarios:[]};
  if(previousSettings&&previousSettings.hotelRadiusKm!==undefined) {
    saved.hotelRadiusKm=previousSettings.hotelRadiusKm;
  }
  for(const scenario of scenarios) {
    const result=readScenarioConfig(scenario);
    if(result.error) {
      setStatus(result.error);
      scenario.card.scrollIntoView({behavior:'smooth',block:'center'});
      return;
    }
    saved.scenarios.push({
      id:scenario.id,
      name:result.name,
      color:result.color,
      config:result.config
    });
  }
  try {
    localStorage.setItem(DashboardCommon.SETTINGS_STORAGE_KEY,JSON.stringify(saved));
  } catch(error) {
    console.error(error);
    setStatus('De instellingen konden niet in browseropslag worden opgeslagen.');
    return;
  }
  window.location.href='index.html';
});

fetch('data.json')
  .then(response=>{
    if(!response.ok)throw new Error(`Routedata kon niet worden geladen (${response.status})`);
    return response.json();
  })
  .then(data=>{
    const route=data.route;
    if(!Array.isArray(route)||route.length<2)throw new Error('De route bevat geen bruikbare kilometervakken.');
    routeTotalKm=Number(route[route.length-1][0]);
    if(!Number.isFinite(routeTotalKm)||routeTotalKm<=0)throw new Error('De totale routelengte is ongeldig.');
    const saved=readSavedSettings();
    const defaultStart=data.schedules.start;
    if(typeof defaultStart!=='string')throw new Error('De standaard starttijd ontbreekt in de routedata.');
    startInput.value=defaultStart.slice(0,16);
    if(saved&&typeof saved.start==='string'&&!Number.isNaN(new Date(saved.start).getTime())) {
      startInput.value=saved.start.slice(0,16);
    } else if(saved&&saved.start) {
      setStatus('De opgeslagen starttijd is ongeldig. Kies een nieuwe starttijd en sla deze op.');
    }
    const defaults=DashboardCommon.defaultScenarios(data.schedules);
    if(defaults.some(scenario=>!isScenarioConfig(scenario.config))) {
      throw new Error('De standaardinstellingen van een schema zijn ongeldig.');
    }
    if(saved&&Array.isArray(saved.scenarios)) {
      const savedScenarios=saved.scenarios;
      const ids=new Set();
      const valid=savedScenarios.length>0&&savedScenarios.every(scenario=>
        scenario&&typeof scenario.id==='string'&&scenario.id.length>0&&!ids.has(scenario.id)&&
        ids.add(scenario.id)&&typeof scenario.name==='string'&&scenario.name.trim().length>0&&
        scenario.name.trim().length<=60&&typeof scenario.color==='string'&&
        /^#[0-9a-f]{6}$/i.test(scenario.color)&&isScenarioConfig(scenario.config)
      );
      if(valid) {
        scenarios=savedScenarios.map(scenario=>({
          id:scenario.id,name:scenario.name.trim(),color:scenario.color,
          config:JSON.parse(JSON.stringify(scenario.config))
        }));
      } else {
        scenarios=defaults.map(scenario=>({...scenario,config:JSON.parse(JSON.stringify(scenario.config))}));
        setStatus('De opgeslagen schema’s zijn ongeldig; standaardwaarden worden getoond.');
      }
    } else {
      scenarios=defaults.map(scenario=>{
        const config=saved&&saved[scenario.id]&&isScenarioConfig(saved[scenario.id])?
          saved[scenario.id]:scenario.config;
        return {...scenario,config:JSON.parse(JSON.stringify(config))};
      });
    }
    scenarios.forEach((scenario,index)=>{
      scenarioContainer.append(renderScenario(scenario));
      const match=/^scenario-(\d+)$/.exec(scenario.id);
      if(match)nextScenarioId=Math.max(nextScenarioId,Number(match[1])+1);
    });
    settingsReady=true;
    saveButton.disabled=false;
    addScenarioButton.disabled=false;
    updateScenarioButtons();
    updateFinishPreviews();
  })
  .catch(error=>{
    console.error(error);
    setStatus(error.message);
  });
