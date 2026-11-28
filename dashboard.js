let DATA = null;

const $=s=>document.querySelector(s), input=$('#kmInput');
const DEFAULT_HOTEL_RADIUS_KM=10;
const CURRENT_KM_COLOR=getComputedStyle(document.documentElement).getPropertyValue('--current-km-color').trim();
const CHECKPOINT_COLOR=getComputedStyle(document.documentElement).getPropertyValue('--checkpoint-color').trim();
let isEditing=false;
let storedHotels=[],hotelDataLoaded=false,hotelDataError=null;
let storedCheckpoints=[],checkpointDataLoaded=false,checkpointDataError=null;
let checkpointPositions=new Map();
let checkpointRouteReady=false,checkpointRouteUnavailable=false,checkpointLoadVersion=0;
let dashboardHotelLayer=null;
let hotelRadiusKm=DEFAULT_HOTEL_RADIUS_KM;
const fmtKm=n=>`${n.toFixed(1).replace('.',',')} km`;
const dt=s=>new Date(s);
const fmtTime=s=>new Intl.DateTimeFormat('nl-NL', {
  weekday:'short',hour:'2-digit',minute:'2-digit'
}).format(dt(s));

function interp(k) {
  const r=DATA.route;
  let lo=0,hi=r.length-1;
  while(hi-lo>1) {
    let m=(lo+hi)>>1;
    if(r[m][0]<k)lo=m;
    else hi=m
  }const a=r[lo],b=r[hi],f=(k-a[0])/(b[0]-a[0]||1);
  return  {
    km:k,lon:a[1]+f*(b[1]-a[1]),lat:a[2]+f*(b[2]-a[2]),ele:a[3]+f*(b[3]-a[3])
  }
} function nearestRouteKm(lngLat) {
  let bestKm=0,bestDistance=Infinity;
  for(const point of DATA.route) {
    const dLng=(point[1]-lngLat.lng)*Math.PI/180,dLat=(point[2]-lngLat.lat)*Math.PI/180;
    const lat1=lngLat.lat*Math.PI/180,lat2=point[2]*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    const distance=6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    if(distance<bestDistance) {
      bestDistance=distance;
      bestKm=point[0]
    }
  }return bestKm
} function currentMunicipality(k) {
  let p=DATA.places[0];
  for(const x of DATA.places) {
    if(x.km<=k)p=x;
    else break
  }return p
} function arrival(sc,k) {
  for(const s of sc.segments) {
    if(k>=s.k0-1e-7&&k<=s.k1+1e-7) {
      let f=(k-s.k0)/(s.k1-s.k0||1);
      return new Date(dt(s.t0).getTime()+f*(dt(s.t1)-dt(s.t0))).toISOString()
    }
  }return sc.finish
} const routeEnd=()=>DATA.route[DATA.route.length-1][0];
const scenarioFinish=sc=>arrival(sc,routeEnd());
function pauseText(p) {
  if(!p)return 'Geen';
  const hours=Math.floor(p.minutes/60),remainingMinutes=p.minutes%60;
  const duration=p.minutes>60?
    `${hours}u${remainingMinutes?` ${remainingMinutes} min`:''}`:
    `${p.minutes} min`;
  if(p.end)return `${duration} vanaf ${fmtTime(p.time)}`;
  return `${duration} om ${fmtTime(p.time)}`
} function scenarioHTML(sc,k) {
  const prev=[...sc.pauses].reverse().find(p=>p.km<=k&&p.km>=k-10), next=sc.pauses.find(p=>p.km>k&&p.km<=k+10);
  return `<div class="schedule-row"><span>Geplande doorkomst</span><span>${fmtTime(arrival(sc,k))}</span></div><div class="schedule-row"><span>Pauze afgelopen 10 km</span><span>${pauseText(prev)}</span></div><div class="schedule-row"><span>Pauze komende 10 km</span><span>${pauseText(next)}</span></div>`
} function renderScenarioCards(scenarios) {
  const container=$('#scenarioCards');
  container.replaceChildren();
  for(const scenario of scenarios) {
    const card=document.createElement('section');
    card.className='card scenario';
    card.style.setProperty('--scenario-color',scenario.color);
    const heading=document.createElement('h2');
    heading.textContent=scenario.name;
    const info=document.createElement('div');
    card.append(heading,info);
    container.append(card);
    scenario.infoElement=info
  }
} let map,marker;
const CARD_STATE_STORAGE_KEY='ultradashboard.dashboardCardState';
let cardStates={};
function applyCardCollapsed(card,collapsed) {
  const toggle=card.querySelector('.card-toggle');
  const content=document.getElementById(toggle.getAttribute('aria-controls'));
  card.classList.toggle('is-collapsed',collapsed);
  toggle.setAttribute('aria-expanded',String(!collapsed));
  content.hidden=collapsed;
}
function setCardCollapsed(card,collapsed) {
  const id=card.dataset.cardId;
  applyCardCollapsed(card,collapsed);
  cardStates[id]=collapsed;
  try {
    localStorage.setItem(CARD_STATE_STORAGE_KEY,JSON.stringify(cardStates));
  } catch(error) {
    console.error('De weergavestatus van dashboardkaarten kon niet worden opgeslagen.',error);
  }
  if(!collapsed) {
    requestAnimationFrame(()=>{
      if(id==='route') {
        if(map)map.resize();
        updateMap(cursorKm);
      } else if(id==='profile') {
        drawProfile();
      } else if(id==='progress') {
        drawProgressChart();
      }
    });
  }
}
function initializeCollapsibleCards() {
  try {
    const saved=localStorage.getItem(CARD_STATE_STORAGE_KEY);
    if(saved) {
      const parsed=JSON.parse(saved);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) {
        throw new Error('De opgeslagen kaartweergave is ongeldig.');
      }
      cardStates=parsed;
    }
  } catch(error) {
    console.error('De opgeslagen kaartweergave kon niet worden gelezen.',error);
    cardStates={};
  }
  for(const card of document.querySelectorAll('.collapsible-card')) {
    const collapsed=cardStates[card.dataset.cardId]===true;
    applyCardCollapsed(card,collapsed);
    card.querySelector('.card-toggle').addEventListener('click',()=>{
      setCardCollapsed(card,!card.classList.contains('is-collapsed'));
    });
  }
} initializeCollapsibleCards();
function readStoredHotels() {
  return AccommodationData.openDatabase().then(database=>
    AccommodationData.readAllHotels(database).finally(()=>database.close())
  );
}
function distanceBetweenCoordinatesKm(first,second) {
  const toRadians=degrees=>degrees*Math.PI/180;
  const latitudeDifference=toRadians(second.latitude-first.latitude);
  const longitudeDifference=toRadians(second.longitude-first.longitude);
  const firstLatitude=toRadians(first.latitude),secondLatitude=toRadians(second.latitude);
  const haversine=Math.sin(latitudeDifference/2)**2+
    Math.cos(firstLatitude)*Math.cos(secondLatitude)*Math.sin(longitudeDifference/2)**2;
  const boundedHaversine=Math.min(1,Math.max(0,haversine));
  return 6371.0088*2*Math.atan2(Math.sqrt(boundedHaversine),Math.sqrt(1-boundedHaversine));
}

function checkpointSegmentPosition(coordinates,index) {
  const start=DATA.route[index],end=DATA.route[index+1];
  const longitudeScale=Math.cos(coordinates.latitude*Math.PI/180);
  const x=(start[1]-coordinates.longitude)*longitudeScale,y=start[2]-coordinates.latitude;
  const dx=(end[1]-start[1])*longitudeScale,dy=end[2]-start[2];
  const denominator=dx*dx+dy*dy;
  const fraction=denominator?Math.max(0,Math.min(1,-(x*dx+y*dy)/denominator)):0;
  return {
    km:start[0]+fraction*(end[0]-start[0]),
    distance:distanceBetweenCoordinatesKm(coordinates,{
      longitude:start[1]+fraction*(end[1]-start[1]),
      latitude:start[2]+fraction*(end[2]-start[2])
    })
  };
}

function checkpointCandidatePosition(coordinates,index) {
  const segmentCount=DATA.route.length-1;
  if(index%2===1&&index<segmentCount*2) {
    return checkpointSegmentPosition(coordinates,(index-1)/2);
  }
  const point=DATA.route[Math.min(Math.floor(index/2),segmentCount)];
  return {
    km:point[0],
    distance:distanceBetweenCoordinatesKm(coordinates,{longitude:point[1],latitude:point[2]})
  };
}

function matchCheckpointPositions(checkpoints) {
  const located=checkpoints.map((checkpoint,index)=>({
    index,coordinates:AccommodationData.getCoordinates(checkpoint)
  })).filter(item=>item.coordinates);
  const matches=new Map();
  if(!located.length)return matches;
  const count=(DATA.route.length-1)*2+1,parents=[];
  let previousCosts=null,previousKms=null;
  for(const item of located) {
    const costs=new Float64Array(count),kms=new Float64Array(count),parent=new Int32Array(count);
    let bestCost=Infinity,bestIndex=-1,previousIndex=0;
    for(let i=0;i<count;i++) {
      const position=checkpointCandidatePosition(item.coordinates,i);
      kms[i]=position.km;
      while(previousCosts&&previousIndex<count&&previousKms[previousIndex]<=position.km) {
        if(previousCosts[previousIndex]<bestCost) {
          bestCost=previousCosts[previousIndex];
          bestIndex=previousIndex;
        }
        previousIndex++;
      }
      costs[i]=(previousCosts?bestCost:0)+position.distance;
      parent[i]=previousCosts?bestIndex:-1;
    }
    previousCosts=costs;
    previousKms=kms;
    parents.push(parent);
  }
  let bestIndex=-1,bestCost=Infinity;
  for(let i=0;i<count;i++) {
    if(previousCosts[i]<bestCost) {
      bestCost=previousCosts[i];
      bestIndex=i;
    }
  }
  if(bestIndex<0)throw new Error('De checkpointvolgorde kan niet op deze route worden bepaald.');
  for(let i=located.length-1;i>=0;i--) {
    matches.set(located[i].index,checkpointCandidatePosition(located[i].coordinates,bestIndex));
    bestIndex=parents[i][bestIndex];
  }
  return matches;
}

function parseCheckpointCutoff(value) {
  if(typeof value!=='string'||!value.trim())return null;
  const text=value.trim();
  let match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  let year,month,day,hour,minute,second;
  if(match) {
    [,year,month,day,hour,minute,second]=match;
  } else {
    match=text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if(!match)return null;
    [,day,month,year,hour,minute,second]=match;
  }
  const parts=[year,month,day,hour,minute,second||'0'].map(Number);
  const date=new Date(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]);
  if(date.getFullYear()!==parts[0]||date.getMonth()!==parts[1]-1||date.getDate()!==parts[2]||
     date.getHours()!==parts[3]||date.getMinutes()!==parts[4]||date.getSeconds()!==parts[5])return null;
  return date;
}

function renderCheckpointOverview() {
  const container=$('#checkpointOverview'),status=$('#checkpointOverviewStatus');
  container.replaceChildren();
  checkpointPositions=new Map();
  if(checkpointDataError) {
    status.textContent=`Checkpointgegevens niet beschikbaar: ${checkpointDataError}`;
    refreshCheckpointVisuals();
    return;
  }
  if(!checkpointDataLoaded) {
    status.textContent='Checkpoints worden geladen.';
    refreshCheckpointVisuals();
    return;
  }
  if(!storedCheckpoints.length) {
    status.textContent='Er zijn nog geen checkpoints geïmporteerd.';
    refreshCheckpointVisuals();
    return;
  }
  let positions=new Map();
  if(checkpointRouteReady) {
    try {
      positions=matchCheckpointPositions(storedCheckpoints);
      checkpointPositions=positions;
    } catch(error) {
      console.error('De checkpointposities konden niet worden berekend.',error);
      status.textContent=error.message||'De checkpointposities konden niet worden berekend.';
    }
  }
  const dateFormatter=new Intl.DateTimeFormat('nl-NL',{
    weekday:'short',day:'numeric',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit'
  });
  for(let index=0;index<storedCheckpoints.length;index++) {
    const checkpoint=storedCheckpoints[index],position=positions.get(index);
    const article=document.createElement('article');
    article.className='checkpoint-overview-item';
    const heading=document.createElement('h3');
    heading.textContent=checkpoint.name;
    article.append(heading);
    const addLine=(label,value,className='')=>{
      const line=document.createElement('p');
      if(className)line.className=className;
      const strong=document.createElement('strong');
      strong.textContent=`${label}: `;
      line.append(strong,document.createTextNode(value));
      article.append(line);
    };
    if(checkpoint.address)addLine('Adres',checkpoint.address);
    if(position) {
      addLine('Routepositie',`${fmtKm(position.km)} (hemelsbreed ${position.distance.toFixed(2).replace('.',',')} km van de route)`);
    } else if(!AccommodationData.getCoordinates(checkpoint)) {
      addLine('Routepositie','Niet berekend: coördinaten ontbreken.');
    } else {
      addLine('Routepositie',checkpointRouteUnavailable?'Niet berekend: importeer eerst een route.':
        checkpointRouteReady?'Niet berekend: controleer de checkpointvolgorde.':'Route wordt geladen.');
    }
    const cutoffText=typeof checkpoint.cutoff==='string'?checkpoint.cutoff.trim():'';
    const cutoff=parseCheckpointCutoff(cutoffText);
    addLine('Cut-off',cutoffText||'Niet opgegeven');
    if(cutoffText&&!cutoff) {
      addLine('Cut-offvergelijking','Niet mogelijk: gebruik JJJJ-MM-DD UU:MM of DD-MM-JJJJ UU:MM.');
    }
    if(checkpoint.extraInfo)addLine('Extra info',checkpoint.extraInfo);
    if(position&&checkpointRouteReady) {
      const times=document.createElement('ul');
      times.className='checkpoint-arrivals';
      for(const scenario of DATA.scenarios) {
        const time=new Date(arrival(scenario.schedule,position.km));
        const late=cutoff&&time.getTime()>cutoff.getTime();
        const lateMinutes=late?Math.ceil((time.getTime()-cutoff.getTime())/60000):0;
        const line=document.createElement('li');
        if(late)line.className='checkpoint-late';
        line.textContent=`${scenario.name}: ${dateFormatter.format(time)}${late?` — ${lateMinutes} ${lateMinutes===1?'minuut':'minuten'} na cut-off`:''}`;
        times.append(line);
      }
      article.append(times);
    }
    container.append(article);
  }
  if(!checkpointRouteReady||positions.size===storedCheckpoints.filter(checkpoint=>
    AccommodationData.getCoordinates(checkpoint)).length) {
    status.textContent='';
  }
  refreshCheckpointVisuals();
}

function updateNextCheckpoint() {
  const distance=$('#nextCheckpointDistance'),name=$('#nextCheckpointName');
  distance.textContent='—';
  if(checkpointDataError) {
    name.textContent='Checkpoints niet beschikbaar';
    return;
  }
  if(!checkpointRouteReady||!checkpointDataLoaded) {
    name.textContent='';
    return;
  }
  let next=null;
  for(let index=0;index<storedCheckpoints.length;index++) {
    const position=checkpointPositions.get(index);
    if(position&&position.km>=cursorKm-0.0000001) {
      next={checkpoint:storedCheckpoints[index],km:position.km};
      break;
    }
  }
  if(!next) {
    name.textContent=storedCheckpoints.length?
      'Geen volgend checkpoint met coördinaten':'Geen checkpoints';
    return;
  }
  distance.textContent=fmtKm(Math.max(0,next.km-cursorKm));
  name.textContent=next.checkpoint.name;
}

function updateCheckpointMap() {
  if(!map||!map.getSource('dashboard-checkpoints'))return;
  const features=checkpointDataError?[]:storedCheckpoints.flatMap((checkpoint,index)=>{
    const coordinates=AccommodationData.getCoordinates(checkpoint);
    if(!coordinates)return [];
    const position=checkpointPositions.get(index);
    return [{
      type:'Feature',
      geometry:{type:'Point',coordinates:[coordinates.longitude,coordinates.latitude]},
      properties:{
        name:checkpoint.name||'Checkpoint',
        routePosition:position?fmtKm(position.km):'',
        cutoff:checkpoint.cutoff||'',
        extraInfo:checkpoint.extraInfo||''
      }
    }];
  });
  map.getSource('dashboard-checkpoints').setData({type:'FeatureCollection',features});
  map.setLayoutProperty('dashboard-checkpoint-markers','visibility',
    $('#showDashboardCheckpoints').checked?'visible':'none');
}

function refreshCheckpointVisuals() {
  updateNextCheckpoint();
  updateCheckpointMap();
  if(checkpointRouteReady) {
    drawProfile();
    drawProgressChart();
  }
}

function loadCheckpointOverview() {
  const version=++checkpointLoadVersion;
  CheckpointData.openDatabase().then(database=>
    CheckpointData.readAll(database).finally(()=>database.close())
  ).then(checkpoints=>{
    if(version!==checkpointLoadVersion)return;
    storedCheckpoints=checkpoints;
    checkpointDataLoaded=true;
    checkpointDataError=null;
    renderCheckpointOverview();
  }).catch(error=>{
    if(version!==checkpointLoadVersion)return;
    console.error('De checkpoints konden niet uit browseropslag worden geladen.',error);
    checkpointDataLoaded=true;
    checkpointDataError=error.message||'De checkpoints konden niet worden geladen.';
    renderCheckpointOverview();
  });
}
loadCheckpointOverview();
addEventListener('focus',loadCheckpointOverview);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)loadCheckpointOverview();
});

function renderNearbyHotels(routePoint) {
  const radiusText=new Intl.NumberFormat('nl-NL',{maximumFractionDigits:1}).format(hotelRadiusKm);
  $('#nearbyHotelsHeading').textContent=`Accommodaties binnen ${radiusText} km`;
  const list=$('#nearbyHotelsList');
  const status=$('#nearbyHotelsStatus');
  list.replaceChildren();
  if(hotelDataError) {
    status.textContent=`Accommodatiegegevens niet beschikbaar: ${hotelDataError}`;
    return;
  }
  if(!hotelDataLoaded) {
    status.textContent='Accommodatiegegevens worden geladen.';
    return;
  }
  const locatedHotels=storedHotels.map(hotel=>({
    hotel,
    coordinates:AccommodationData.getCoordinates(hotel)
  })).filter(item=>item.coordinates);
  if(locatedHotels.length===0) {
    status.textContent=storedHotels.length===0?
      'Er zijn geen accommodaties opgeslagen.':
      'Geen opgeslagen accommodaties met geldige coördinaten.';
    return;
  }
  const nearbyHotels=locatedHotels.map(item=>({
    hotel:item.hotel,
    distance:distanceBetweenCoordinatesKm({
      longitude:routePoint.lon,
      latitude:routePoint.lat
    },item.coordinates)
  })).filter(item=>item.distance<=hotelRadiusKm)
    .sort((first,second)=>first.distance-second.distance);
  if(nearbyHotels.length===0) {
    status.textContent=`Geen accommodaties binnen ${radiusText} km van het geselecteerde routepunt.`;
    return;
  }
  for(const item of nearbyHotels) {
    const row=document.createElement('li');
    const details=document.createElement('div');
    const name=document.createElement('strong');
    name.textContent=item.hotel.name||'Accommodatie zonder naam';
    const address=document.createElement('span');
    address.textContent=item.hotel.address||'Adres onbekend';
    details.append(name,address);
    const websiteValue=typeof item.hotel.website==='string'?item.hotel.website.trim():'';
    const websiteUrl=websiteValue?
      AccommodationMapLayer.safeAccommodationWebsite(/^https?:\/\//i.test(websiteValue)?websiteValue:`https://${websiteValue}`):
      null;
    if(websiteUrl) {
      const website=document.createElement('a');
      website.href=websiteUrl;
      website.target='_blank';
      website.rel='noopener noreferrer';
      website.textContent=websiteValue;
      details.append(website);
    }
    if(typeof item.hotel.extraInfo==='string'&&item.hotel.extraInfo.trim()) {
      const extraInfo=document.createElement('span');
      extraInfo.className='nearby-hotel-extra-info';
      extraInfo.textContent=item.hotel.extraInfo;
      details.append(extraInfo);
    }
    const distance=document.createElement('span');
    distance.className='nearby-hotel-distance';
    distance.textContent=fmtKm(item.distance);
    row.append(details,distance);
    list.append(row);
  }
  status.textContent=`${nearbyHotels.length} ${nearbyHotels.length===1?'accommodatie':'accommodaties'} binnen ${radiusText} km van het geselecteerde routepunt.`;
}
function loadNearbyHotels() {
  readStoredHotels().then(hotels=>{
    storedHotels=hotels;
    hotelDataLoaded=true;
    hotelDataError=null;
    if(dashboardHotelLayer)dashboardHotelLayer.setHotels(hotels);
    renderNearbyHotels(interp(cursorKm));
  }).catch(error=>{
    console.error('De accommodatiegegevens konden niet uit browseropslag worden geladen.',error);
    hotelDataLoaded=true;
    hotelDataError=error.message||'De opgeslagen accommodaties konden niet worden geladen.';
    $('#dashboardHotelStatus').textContent=`Accommodatiegegevens niet beschikbaar: ${hotelDataError}`;
    if(dashboardHotelLayer)dashboardHotelLayer.setHotels([]);
    renderNearbyHotels(interp(cursorKm));
  });
}
function initMap() {
  try {
    map=new maplibregl.Map( {
      container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[DATA.route[0][1],DATA.route[0][2]],zoom:10
    });
    map.addControl(new maplibregl.NavigationControl(),'top-right');
    map.on('load',()=> {
      map.addSource('route', {
        type:'geojson',data: {
          type:'Feature',geometry: {
            type:'LineString',coordinates:DATA.route.map(x=>[x[1],x[2]])
          }
        }
      });
      map.addLayer( {
        id:'route-line',type:'line',source:'route',paint: {
          'line-color':'#234930','line-width':5,'line-opacity':.9
        }
      });
      map.addSource('dashboard-checkpoints',{
        type:'geojson',data:{type:'FeatureCollection',features:[]}
      });
      map.addLayer({
        id:'dashboard-checkpoint-markers',type:'circle',source:'dashboard-checkpoints',
        paint:{
          'circle-radius':8,'circle-color':CHECKPOINT_COLOR,
          'circle-stroke-color':'#fff','circle-stroke-width':2
        }
      });
      updateCheckpointMap();
      map.on('click','dashboard-checkpoint-markers',event=>{
        const checkpoint=event.features&&event.features[0]&&event.features[0].properties;
        if(!checkpoint)return;
        const content=document.createElement('div');
        const heading=document.createElement('strong');
        heading.textContent=checkpoint.name;
        content.append(heading);
        for(const [label,value] of [
          ['Routepositie',checkpoint.routePosition],
          ['Cut-off',checkpoint.cutoff],
          ['Extra info',checkpoint.extraInfo]
        ]) {
          if(!value)continue;
          const line=document.createElement('p');
          line.textContent=`${label}: ${value}`;
          content.append(line);
        }
        new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(map);
      });
      map.on('mouseenter','dashboard-checkpoint-markers',()=>{map.getCanvas().style.cursor='pointer'});
      map.on('mouseleave','dashboard-checkpoint-markers',()=>{map.getCanvas().style.cursor=''});
      dashboardHotelLayer=AccommodationMapLayer.create(map,{
        sourceId:'dashboard-accommodations',
        layerId:'dashboard-accommodation-markers',
        toggle:$('#showDashboardHotels'),
        status:$('#dashboardHotelStatus')
      });
      map.moveLayer('dashboard-checkpoint-markers');
      dashboardHotelLayer.setHotels(storedHotels);
      if(hotelDataError) {
        $('#dashboardHotelStatus').textContent=`Accommodatiegegevens niet beschikbaar: ${hotelDataError}`;
      }
      map.on('click','route-line',event=>{
        if(map.queryRenderedFeatures(event.point,{layers:['dashboard-checkpoint-markers']}).length)return;
        update(nearestRouteKm(event.lngLat),false,true)
      });
      map.on('mouseenter','route-line',()=>{map.getCanvas().style.cursor='pointer'});
      map.on('mouseleave','route-line',()=>{map.getCanvas().style.cursor=''});
      const dot=document.createElement('div');
      dot.style.width='18px';
      dot.style.height='18px';
      dot.style.border='3px solid #fff';
      dot.style.borderRadius='50%';
      dot.style.background=CURRENT_KM_COLOR;
      dot.style.boxShadow='0 2px 8px #17211d66';
      dot.style.cursor='grab';
      marker=new maplibregl.Marker( {
        element:dot,draggable:true
      }).setLngLat([DATA.route[0][1],DATA.route[0][2]]).addTo(map);
      marker.on('drag',()=> {
        const position=marker.getLngLat();
        update(nearestRouteKm(position),false,true)
      });
      marker.on('dragend',()=> {
        const position=marker.getLngLat();
        update(nearestRouteKm(position),false,true)
      });
      updateMap(0)
    });
    map.on('error',e=> {
      if(!map.loaded())$('#mapWarn').style.display='block'
    })
  }catch(e) {
    $('#mapWarn').style.display='block'
  }
} function updateMap(k,fromMap=false) {
  if(!map||!marker)return;
  const p=interp(k);
  marker.setLngLat([p.lon,p.lat]);
  if(fromMap||$('#routeCardContent').hidden)return;
  const a=interp(Math.max(0,k-10)),b=interp(Math.min(DATA.total,k+10));
  const bounds=new maplibregl.LngLatBounds();
  const start=Math.max(0,k-10),end=Math.min(DATA.total,k+10);
  DATA.route.filter(x=>x[0]>=start&&x[0]<=end).forEach(x=>bounds.extend([x[1],x[2]]));
  bounds.extend([a.lon,a.lat]);
  bounds.extend([b.lon,b.lat]);
  map.fitBounds(bounds, {
    padding:55,maxZoom:13,duration:500
  })
} const canvas=$('#profile'),ctx=canvas.getContext('2d');
const progressCanvas=$('#progressChart'),progressContext=progressCanvas.getContext('2d');
let cursorKm=0;
function drawProfile() {
  if (!DATA) return;

  const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
  canvas.width=rect.width*dpr;
  canvas.height=rect.height*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=rect.width,h=rect.height,pad= {
    l:48,r:16,t:14,b:28
  };
  let min=Math.min(...DATA.route.map(x=>x[3])),max=Math.max(...DATA.route.map(x=>x[3]));
  min=Math.floor(min/50)*50;
  max=Math.ceil(max/50)*50;
  const X=k=>pad.l+k/DATA.total*(w-pad.l-pad.r),Y=e=>pad.t+(max-e)/(max-min||1)*(h-pad.t-pad.b);
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#e2e8e5';
  ctx.fillStyle='#66736d';
  ctx.font='12px system-ui';
  ctx.textAlign='right';
  for(let i=0;
  i<=4;
  i++) {
    let e=min+(max-min)*i/4,y=Y(e);
    ctx.beginPath();
    ctx.moveTo(pad.l,y);
    ctx.lineTo(w-pad.r,y);
    ctx.stroke();
    ctx.fillText(Math.round(e)+' m',pad.l-7,y+4)
  }ctx.beginPath();
  DATA.route.forEach((p,i)=>i?ctx.lineTo(X(p[0]),Y(p[3])):ctx.moveTo(X(p[0]),Y(p[3])));
  ctx.lineTo(X(DATA.total),h-pad.b);
  ctx.lineTo(X(0),h-pad.b);
  ctx.closePath();
  ctx.fillStyle='#d9e6df';
  ctx.fill();
  if($('#showProfileCheckpoints').checked) {
    ctx.save();
    ctx.strokeStyle=CHECKPOINT_COLOR;
    ctx.lineWidth=1.5;
    ctx.setLineDash([5,4]);
    for(const position of checkpointPositions.values()) {
      ctx.beginPath();
      ctx.moveTo(X(position.km),pad.t);
      ctx.lineTo(X(position.km),h-pad.b);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.beginPath();
  DATA.route.forEach((p,i)=>i?ctx.lineTo(X(p[0]),Y(p[3])):ctx.moveTo(X(p[0]),Y(p[3])));
  ctx.strokeStyle='#234930';
  ctx.lineWidth=2;
  ctx.stroke();
  for(let i=0;
  i<=5;
  i++) {
    let k=DATA.total*i/5,x=X(k);
    ctx.fillStyle='#66736d';
    ctx.textAlign='center';
    ctx.fillText(Math.round(k)+' km',x,h-7)
  }let x=X(cursorKm);
  ctx.beginPath();
  ctx.moveTo(x,pad.t);
  ctx.lineTo(x,h-pad.b);
  ctx.strokeStyle=CURRENT_KM_COLOR;
  ctx.lineWidth=2;
  ctx.stroke();
  const p=interp(cursorKm);
  ctx.fillStyle=CURRENT_KM_COLOR;
  ctx.beginPath();
  ctx.arc(x,Y(p.ele),5,0,Math.PI*2);
  ctx.fill()
} function elapsedProgress(schedule,startTime) {
  const startMilliseconds=new Date(startTime).getTime();
  const points=[];
  for(const segment of schedule.segments) {
    const segmentStart=new Date(segment.t0).getTime();
    const segmentEnd=new Date(segment.t1).getTime();
    if(!Number.isFinite(segmentStart)||!Number.isFinite(segmentEnd))continue;
    if(!points.length) {
      points.push({hours:0,km:segment.k0});
    } else {
      const previous=points[points.length-1];
      const previousMilliseconds=startMilliseconds+previous.hours*60*60*1000;
      if(segmentStart>previousMilliseconds) {
        points.push({
          hours:(segmentStart-startMilliseconds)/3600000,
          km:segment.k0
        });
      }
    }
    points.push({
      hours:(segmentEnd-startMilliseconds)/3600000,
      km:segment.k1
    });
  }
  return points
} function drawProgressChart() {
  if(!DATA||!DATA.scenarios||!DATA.scenarios.length)return;
  const rect=progressCanvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
  if(!rect.width||!rect.height)return;
  progressCanvas.width=rect.width*dpr;
  progressCanvas.height=rect.height*dpr;
  progressContext.setTransform(dpr,0,0,dpr,0,0);
  const width=rect.width,height=rect.height,pad={left:62,right:18,top:18,bottom:56};
  const plotWidth=width-pad.left-pad.right,plotHeight=height-pad.top-pad.bottom;
  const startTime=DATA.schedules.start;
  const startMilliseconds=new Date(startTime).getTime();
  const maxHours=Math.max(...DATA.scenarios.map(scenario=>
    (new Date(scenario.schedule.finish).getTime()-startMilliseconds)/3600000
  ));
  if(!Number.isFinite(maxHours)||maxHours<=0)return;
  const x=hours=>pad.left+hours/maxHours*plotWidth;
  const y=km=>pad.top+(DATA.total-km)/DATA.total*plotHeight;
  progressContext.clearRect(0,0,width,height);
  progressContext.font='12px system-ui';
  progressContext.lineWidth=1;
  progressContext.strokeStyle='#e2e8e5';
  progressContext.fillStyle='#66736d';
  progressContext.textAlign='right';
  progressContext.textBaseline='middle';
  for(let tick=0;tick<=5;tick++) {
    const km=DATA.total*tick/5,position=y(km);
    progressContext.beginPath();
    progressContext.moveTo(pad.left,position);
    progressContext.lineTo(width-pad.right,position);
    progressContext.stroke();
    progressContext.fillText(`${Math.round(km)} km`,pad.left-8,position);
  }
  progressContext.textAlign='center';
  progressContext.textBaseline='top';
  for(let tick=0;tick<=5;tick++) {
    const hours=maxHours*tick/5,position=x(hours);
    progressContext.beginPath();
    progressContext.moveTo(position,pad.top);
    progressContext.lineTo(position,height-pad.bottom);
    progressContext.stroke();
    progressContext.fillText(`${Math.round(hours)} u`,position,height-pad.bottom+8);
  }
  if($('#showProgressCheckpoints').checked) {
    progressContext.save();
    progressContext.strokeStyle=CHECKPOINT_COLOR;
    progressContext.lineWidth=1.5;
    progressContext.setLineDash([5,4]);
    for(const position of checkpointPositions.values()) {
      progressContext.beginPath();
      progressContext.moveTo(pad.left,y(position.km));
      progressContext.lineTo(width-pad.right,y(position.km));
      progressContext.stroke();
    }
    progressContext.restore();
  }
  progressContext.save();
  progressContext.translate(15,pad.top+plotHeight/2);
  progressContext.rotate(-Math.PI/2);
  progressContext.textAlign='center';
  progressContext.textBaseline='middle';
  progressContext.fillStyle='#66736d';
  progressContext.fillText('Afgelegd (km)',0,0);
  progressContext.restore();
  progressContext.textAlign='center';
  progressContext.textBaseline='bottom';
  progressContext.fillText('Verstreken tijd (uren)',pad.left+plotWidth/2,height-3);
  for(const scenario of DATA.scenarios) {
    const points=elapsedProgress(scenario.schedule,startTime);
    if(!points.length)continue;
    progressContext.beginPath();
    points.forEach((point,index)=>{
      const px=x(point.hours),py=y(point.km);
      if(index===0)progressContext.moveTo(px,py);
      else progressContext.lineTo(px,py);
    });
    progressContext.strokeStyle=scenario.color;
    progressContext.lineWidth=2.5;
    progressContext.lineJoin='round';
    progressContext.lineCap='round';
    progressContext.stroke();
  }
  const cursorY=Math.max(pad.top,Math.min(height-pad.bottom-2,y(cursorKm)-1));
  progressContext.fillStyle=CURRENT_KM_COLOR;
  progressContext.fillRect(pad.left,cursorY,plotWidth,2);
} function renderProgressLegend(scenarios) {
  const legend=$('#progressLegend');
  legend.replaceChildren();
  for(const scenario of scenarios) {
    const item=document.createElement('span');
    item.className='progress-legend-item';
    const line=document.createElement('i');
    line.className='progress-legend-line';
    line.style.setProperty('--scenario-color',scenario.color);
    const name=document.createElement('span');
    name.textContent=scenario.name;
    item.append(line,name);
    legend.append(item);
  }
  const checkpointItem=document.createElement('span');
  checkpointItem.className='progress-legend-item';
  const checkpointLine=document.createElement('i');
  checkpointLine.className='progress-legend-line progress-legend-checkpoint';
  const checkpointLabel=document.createElement('span');
  checkpointLabel.textContent='Checkpoints';
  checkpointItem.append(checkpointLine,checkpointLabel);
  legend.append(checkpointItem);
} function update(v,fromPointer=false,fromMap=false) {
  let k=Math.max(0,Math.min(DATA.total,Number(v)||0));
  cursorKm=k;
  if(!isEditing||fromPointer) input.value=k.toFixed(1);
  const p=interp(k),place=currentMunicipality(k);
  $('#remaining').textContent=fmtKm(DATA.total-k);
  updateNextCheckpoint();
  $('#elevation').textContent=`${Math.round(p.ele)} m`;
  $('#currentPlace').textContent=place.name;
  renderNearbyHotels(p);
  const next=DATA.places.filter(x=>x.km>k+.01).slice(0,3);
  $('#nextPlaces').innerHTML=next.length?next.map(x=>`<li><span>${x.name} <small>(${x.country})</small></span><strong>over ${fmtKm(x.km-k)}</strong></li>`).join(''):'<li><span>Geen volgende gemeentegrens meer</span><strong>finish</strong></li>';
  for(const scenario of DATA.scenarios) {
    scenario.infoElement.innerHTML=scenarioHTML(scenario.schedule,k)
  }
  updateMap(k,fromMap);
  drawProfile();
  drawProgressChart()
} input.addEventListener('focus',()=>isEditing=true);
input.addEventListener('input',()=> {
  const v=parseFloat(input.value.replace(',','.'));
  if(!Number.isNaN(v)) update(v);

});
input.addEventListener('blur',()=> {
  isEditing=false;
  const v=parseFloat(input.value.replace(',','.'));
  if(!Number.isNaN(v)) update(v);

});
input.addEventListener('keydown',e=> {
  if(e.key==='Enter') input.blur();

});
function pointer(e) {
  const r=canvas.getBoundingClientRect();
  update((e.clientX-r.left)/r.width*DATA.total,true)
}canvas.addEventListener('pointerdown',e=> {
  canvas.setPointerCapture(e.pointerId);
  pointer(e)
});
canvas.addEventListener('pointermove',e=> {
  if(canvas.hasPointerCapture(e.pointerId))pointer(e)
});
function progressPointer(e) {
  const rect=progressCanvas.getBoundingClientRect(),top=18,bottom=56;
  const position=Math.max(top,Math.min(rect.height-bottom,e.clientY-rect.top));
  update((1-(position-top)/(rect.height-top-bottom))*DATA.total,true)
} progressCanvas.addEventListener('pointerdown',e=>{
  progressCanvas.setPointerCapture(e.pointerId);
  progressPointer(e)
});
progressCanvas.addEventListener('pointermove',e=>{
  if(progressCanvas.hasPointerCapture(e.pointerId))progressPointer(e)
});
addEventListener('resize',()=>{drawProfile();drawProgressChart()});
$('#showDashboardCheckpoints').addEventListener('change',updateCheckpointMap);
$('#showProfileCheckpoints').addEventListener('change',drawProfile);
$('#showProgressCheckpoints').addEventListener('change',drawProgressChart);
function showRouteUnavailable(reason) {
  checkpointRouteReady=false;
  checkpointRouteUnavailable=true;
  renderCheckpointOverview();
  const guidance='Importeer eerst een GPX via Routeimport om het dashboard en de schema-berekeningen te vullen.';
  const message=reason?`${reason} ${guidance}`:guidance;
  input.disabled=true;
  input.value='';
  $('#routeSummary').textContent=reason||'Er is nog geen route geïmporteerd.';
  $('#remaining').textContent='—';
  $('#nextCheckpointDistance').textContent='—';
  $('#nextCheckpointName').textContent='';
  $('#elevation').textContent='—';
  $('#currentPlace').textContent='Geen route';
  const nextPlace=document.createElement('li');
  nextPlace.textContent=message;
  $('#nextPlaces').replaceChildren(nextPlace);

  const scenarioMessage=document.createElement('p');
  scenarioMessage.className='route-empty-state';
  scenarioMessage.textContent='Schema’s en finishtijden verschijnen nadat je een GPX hebt geïmporteerd.';
  $('#scenarioCards').replaceChildren(scenarioMessage);

  $('#nearbyHotelsHeading').textContent='Accommodaties langs de route';
  $('#nearbyHotelsDescription').textContent=guidance;
  $('#nearbyHotelsList').replaceChildren();
  $('#nearbyHotelsStatus').textContent=guidance;

  $('#map').hidden=true;
  $('#mapWarn').style.display='none';
  $('#mapEmptyState').textContent=message;
  $('#mapEmptyState').hidden=false;
  $('#dashboardHotelToggleLabel').hidden=true;
  $('#dashboardCheckpointToggleLabel').hidden=true;
  $('#dashboardHotelStatus').hidden=true;
  $('#mapAttribution').hidden=true;

  $('#profileCardContent .profile-wrap').hidden=true;
  $('#profileCardContent .legend').hidden=true;
  $('#profileEmptyState').textContent=message;
  $('#profileEmptyState').hidden=false;
  $('#profileCheckpointToggleLabel').hidden=true;
  $('#progressCardContent .progress-chart-wrap').hidden=true;
  $('#progressLegend').hidden=true;
  $('#progressEmptyState').textContent=message;
  $('#progressEmptyState').hidden=false;
  $('#progressCheckpointToggleLabel').hidden=true;
}
      Promise.all([
        fetch('data.json').then(response=>{
          if(!response.ok)throw new Error(`Instellingen konden niet worden geladen (${response.status})`);
          return response.json();
        }),
        RouteStorage.load()
      ])
        .then(([json,routeData]) => {
          if(!routeData) {
            showRouteUnavailable();
            return;
          }
          DATA = {...json,...routeData};
          let scenarios;
          try {
            const storedSettings=localStorage.getItem(DashboardCommon.SETTINGS_STORAGE_KEY);
            if(storedSettings) {
              const settings=JSON.parse(storedSettings);
              if(!settings||typeof settings!=='object') {
                throw new Error('De opgeslagen schema-instellingen zijn ongeldig.');
              }
              if(settings.hotelRadiusKm!==undefined) {
                if(typeof settings.hotelRadiusKm==='number'&&
                   Number.isFinite(settings.hotelRadiusKm)&&settings.hotelRadiusKm>=0) {
                  hotelRadiusKm=settings.hotelRadiusKm;
                } else {
                  console.warn('De ingestelde straal voor accommodaties is ongeldig; 10 km wordt gebruikt.');
                }
              }
              if(typeof settings.start==='string')DATA.schedules.start=settings.start;
              const defaults=DashboardCommon.defaultScenarios(DATA.schedules);
              if(Array.isArray(settings.scenarios)) {
                const ids=new Set();
                const valid=settings.scenarios.length>0&&settings.scenarios.every(scenario=>
                  scenario&&typeof scenario.id==='string'&&scenario.id.length>0&&!ids.has(scenario.id)&&
                  ids.add(scenario.id)&&typeof scenario.name==='string'&&scenario.name.trim().length>0&&
                  scenario.name.trim().length<=60&&typeof scenario.color==='string'&&
                  /^#[0-9a-f]{6}$/i.test(scenario.color)&&scenario.config&&
                  DashboardCommon.hasSpeedZones(scenario.config)
                );
                if(!valid)throw new Error('De opgeslagen schema’s zijn ongeldig.');
                scenarios=settings.scenarios.map(scenario=>({
                  id:scenario.id,
                  name:scenario.name.trim(),
                  color:scenario.color,
                  config:scenario.config
                }));
              } else {
                scenarios=defaults.map(scenario=>({
                  ...scenario,
                  config:settings[scenario.id]&&Array.isArray(settings[scenario.id].speedZones)?
                    settings[scenario.id]:scenario.config
                }));
              }
            } else {
              DATA.schedules.start=localStorage.getItem(DashboardCommon.LEGACY_START_STORAGE_KEY)||DATA.schedules.start;
              scenarios=DashboardCommon.defaultScenarios(DATA.schedules);
            }
          } catch (error) {
            console.error(error);
            throw new Error(error.message||'De schema-instellingen konden niet uit browseropslag worden gelezen.');
          }
          DATA.scenarios=scenarios.map(scenario=>({
            ...scenario,
            schedule:buildSchedule(scenario.config,DATA.schedules.start,DATA.route[DATA.route.length-1][0])
          }));
          checkpointRouteReady=true;
          checkpointRouteUnavailable=false;
          renderCheckpointOverview();
          renderScenarioCards(DATA.scenarios);
          renderProgressLegend(DATA.scenarios);
          input.max = DATA.total;
          input.value = '0';
          $('#routeSummary').textContent = `Totale lengte ${fmtKm(routeEnd())} · ${DATA.scenarios.map(scenario=>`${scenario.name}: finish ${fmtTime(scenarioFinish(scenario.schedule))}`).join(' · ')}`;
          drawProgressChart();
          initMap();
          update(0);
          loadNearbyHotels();
        })
        .catch(error => {
          console.error(error);
          showRouteUnavailable(error.message||'Routedata kon niet worden geladen.');
        });
