const ROUTE_SAMPLE_INTERVAL_KM=0.2;
const PLACE_SAMPLE_INTERVAL_KM=0.025;
const GEOJSON_INDEX_CELL_SIZE=0.1;
const EARTH_RADIUS_KM=6371.0088;
const GEOJSON_SOURCES=[
  {
    path:'geojson/gemeente nederland.geojson',
    country:'Nederland',
    getName:properties=>properties.statnaam
  },
  {
    path:'geojson/communesgemeente-belgium.geojson',
    country:'België',
    getName:properties=>properties.mun_name_nl?.[0]||
      properties.mun_name_fr?.[0]||properties.mun_name_de?.[0]
  },
  {
    path:'geojson/gemeente luxemburg.geojson',
    country:'Luxemburg',
    getName:properties=>properties.COMMUNE
  }
];

const routeImportButton=document.querySelector('#routeImportButton');
const routeImportFile=document.querySelector('#routeImportFile');
const routeImportStatus=document.querySelector('#routeImportStatus');

function haversineDistance(a,b) {
  const lat1=a.lat*Math.PI/180,lat2=b.lat*Math.PI/180;
  const dLat=(b.lat-a.lat)*Math.PI/180,dLon=(b.lon-a.lon)*Math.PI/180;
  const h=Math.sin(dLat/2)**2+
    Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return EARTH_RADIUS_KM*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function parseTrackPoints(xml) {
  const document=new DOMParser().parseFromString(xml,'application/xml');
  if(document.documentElement.localName!=='gpx'||
     document.getElementsByTagName('parsererror').length) {
    throw new Error('Het gekozen bestand bevat geen geldige GPX.');
  }
  const trackElements=Array.from(document.getElementsByTagNameNS('*','trkpt'));
  const elements=trackElements.length?trackElements:
    Array.from(document.getElementsByTagNameNS('*','rtept'));
  if(elements.length<2)throw new Error('De GPX bevat geen bruikbare track of route met minimaal twee punten.');

  const points=[];
  elements.forEach((element,index)=>{
    const lat=Number(element.getAttribute('lat'));
    const lon=Number(element.getAttribute('lon'));
    const elevation=Number(element.getElementsByTagNameNS('*','ele')[0]?.textContent);
    if(!Number.isFinite(lat)||Math.abs(lat)>90||
       !Number.isFinite(lon)||Math.abs(lon)>180) {
      throw new Error(`GPX-trackpunt ${index+1} bevat ongeldige coördinaten.`);
    }
    if(!Number.isFinite(elevation)) {
      throw new Error(`GPX-trackpunt ${index+1} bevat geen geldige hoogte.`);
    }
    const point={lon,lat,elevation};
    if(points.length&&haversineDistance(points[points.length-1],point)<0.000001) {
      points[points.length-1]=point;
    } else {
      points.push(point);
    }
  });
  if(points.length<2)throw new Error('De GPX-track bevat minder dan twee unieke punten.');
  return points;
}

function buildCumulativeDistances(points) {
  const distances=[0];
  for(let i=1;i<points.length;i++) {
    distances.push(distances[i-1]+haversineDistance(points[i-1],points[i]));
  }
  return distances;
}

function interpolateTrack(points,distances,distanceKm) {
  if(distanceKm<=0)return points[0];
  const total=distances[distances.length-1];
  if(distanceKm>=total)return points[points.length-1];

  let low=0,high=distances.length-1;
  while(high-low>1) {
    const middle=(low+high)>>1;
    if(distances[middle]<distanceKm)low=middle;
    else high=middle;
  }
  const start=points[low],end=points[high];
  const fraction=(distanceKm-distances[low])/(distances[high]-distances[low]);
  return {
    lon:start.lon+fraction*(end.lon-start.lon),
    lat:start.lat+fraction*(end.lat-start.lat),
    elevation:start.elevation+fraction*(end.elevation-start.elevation)
  };
}

function rounded(value,digits) {
  return Number(value.toFixed(digits));
}

function createRouteTrack(points,distances,totalKm) {
  const route=[];
  for(let index=0;index*ROUTE_SAMPLE_INTERVAL_KM<totalKm;index++) {
    const distanceKm=index*ROUTE_SAMPLE_INTERVAL_KM;
    const point=interpolateTrack(points,distances,distanceKm);
    route.push([
      rounded(distanceKm,3),
      rounded(point.lon,6),
      rounded(point.lat,6),
      rounded(point.elevation,1)
    ]);
  }
  const end=points[points.length-1];
  route.push([
    rounded(totalKm,3),
    rounded(end.lon,6),
    rounded(end.lat,6),
    rounded(end.elevation,1)
  ]);
  return route;
}

function getBounds(coordinates,bounds) {
  if(typeof coordinates[0]==='number') {
    bounds.minLon=Math.min(bounds.minLon,coordinates[0]);
    bounds.minLat=Math.min(bounds.minLat,coordinates[1]);
    bounds.maxLon=Math.max(bounds.maxLon,coordinates[0]);
    bounds.maxLat=Math.max(bounds.maxLat,coordinates[1]);
    return;
  }
  coordinates.forEach(child=>getBounds(child,bounds));
}

async function loadMunicipalities() {
  const collections=await Promise.all(GEOJSON_SOURCES.map(async source=>{
    const response=await fetch(source.path);
    if(!response.ok) {
      throw new Error(`Gemeentegrenzen konden niet worden geladen (${response.status}): ${source.path}`);
    }
    const collection=await response.json();
    if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features)) {
      throw new Error(`Het gemeentegrenzenbestand is ongeldig: ${source.path}`);
    }
    return {source,features:collection.features};
  }));
  const municipalities=[];
  for(const {source,features} of collections) {
    for(const feature of features) {
      const name=source.getName(feature.properties||'');
      if(!name||!feature.geometry)continue;
      let polygons;
      if(feature.geometry.type==='Polygon')polygons=[feature.geometry.coordinates];
      else if(feature.geometry.type==='MultiPolygon')polygons=feature.geometry.coordinates;
      else continue;
      const bounds={minLon:Infinity,minLat:Infinity,maxLon:-Infinity,maxLat:-Infinity};
      getBounds(feature.geometry.coordinates,bounds);
      municipalities.push({country:source.country,name,polygons,bounds});
    }
  }
  if(!municipalities.length)throw new Error('Er zijn geen bruikbare gemeentegrenzen gevonden.');
  const cells=new Map();
  for(const municipality of municipalities) {
    const minX=Math.floor(municipality.bounds.minLon/GEOJSON_INDEX_CELL_SIZE);
    const maxX=Math.floor(municipality.bounds.maxLon/GEOJSON_INDEX_CELL_SIZE);
    const minY=Math.floor(municipality.bounds.minLat/GEOJSON_INDEX_CELL_SIZE);
    const maxY=Math.floor(municipality.bounds.maxLat/GEOJSON_INDEX_CELL_SIZE);
    for(let x=minX;x<=maxX;x++) {
      for(let y=minY;y<=maxY;y++) {
        const key=`${x}:${y}`;
        if(!cells.has(key))cells.set(key,[]);
        cells.get(key).push(municipality);
      }
    }
  }
  return cells;
}

function pointInRing(point,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j],b=ring[i];
    const cross=(point.lon-a[0])*(b[1]-a[1])-(point.lat-a[1])*(b[0]-a[0]);
    if(Math.abs(cross)<1e-10&&
       point.lon>=Math.min(a[0],b[0])-1e-10&&point.lon<=Math.max(a[0],b[0])+1e-10&&
       point.lat>=Math.min(a[1],b[1])-1e-10&&point.lat<=Math.max(a[1],b[1])+1e-10) {
      return true;
    }
    if((a[1]>point.lat)!==(b[1]>point.lat)&&
       point.lon<(b[0]-a[0])*(point.lat-a[1])/(b[1]-a[1])+a[0]) {
      inside=!inside;
    }
  }
  return inside;
}

function pointInMunicipality(point,municipality) {
  return municipality.polygons.some(polygon=>
    pointInRing(point,polygon[0])&&!polygon.slice(1).some(hole=>pointInRing(point,hole))
  );
}

function findMunicipality(point,cells) {
  const key=`${Math.floor(point.lon/GEOJSON_INDEX_CELL_SIZE)}:${Math.floor(point.lat/GEOJSON_INDEX_CELL_SIZE)}`;
  for(const municipality of cells.get(key)||[]) {
    const bounds=municipality.bounds;
    if(point.lon<bounds.minLon||point.lon>bounds.maxLon||
       point.lat<bounds.minLat||point.lat>bounds.maxLat)continue;
    if(pointInMunicipality(point,municipality))return municipality;
  }
  return null;
}

function sameMunicipality(a,b) {
  return a&&b&&a.country===b.country&&a.name===b.name;
}

function findBoundaryKm(points,distances,cells,startKm,endKm,startMunicipality) {
  let low=startKm,high=endKm;
  for(let i=0;i<20;i++) {
    const middle=(low+high)/2;
    const point=interpolateTrack(points,distances,middle);
    if(sameMunicipality(findMunicipality(point,cells),startMunicipality))low=middle;
    else high=middle;
  }
  return high;
}

function createMunicipalityPlaces(points,distances,totalKm,cells) {
  const firstMunicipality=findMunicipality(points[0],cells);
  if(!firstMunicipality)throw new Error('Het beginpunt ligt buiten de beschikbare gemeentegrenzen.');
  const places=[{km:0,country:firstMunicipality.country,name:firstMunicipality.name}];
  let previous={km:0,municipality:firstMunicipality};

  for(let km=PLACE_SAMPLE_INTERVAL_KM;km<totalKm;km+=PLACE_SAMPLE_INTERVAL_KM) {
    const point=interpolateTrack(points,distances,km);
    const municipality=findMunicipality(point,cells);
    if(!municipality)continue;
    if(!sameMunicipality(municipality,previous.municipality)) {
      const boundaryKm=findBoundaryKm(
        points,distances,cells,previous.km,km,previous.municipality
      );
      places.push({
        km:rounded(boundaryKm,2),
        country:municipality.country,
        name:municipality.name
      });
    }
    previous={km,municipality};
  }

  const lastPoint=points[points.length-1];
  const lastMunicipality=findMunicipality(lastPoint,cells);
  if(lastMunicipality&&!sameMunicipality(lastMunicipality,previous.municipality)) {
    const boundaryKm=findBoundaryKm(
      points,distances,cells,previous.km,totalKm,previous.municipality
    );
    places.push({
      km:rounded(boundaryKm,2),
      country:lastMunicipality.country,
      name:lastMunicipality.name
    });
  }
  return places;
}

async function createRouteData(file) {
  if(!file.name.toLowerCase().endsWith('.gpx'))throw new Error('Selecteer een GPX-bestand.');
  const points=parseTrackPoints(await file.text());
  const distances=buildCumulativeDistances(points);
  const rawTotalKm=distances[distances.length-1];
  if(!Number.isFinite(rawTotalKm)||rawTotalKm<=0)throw new Error('De GPX-track heeft geen geldige lengte.');
  const municipalityCells=await loadMunicipalities();
  return {
    total:rounded(rawTotalKm,3),
    route:createRouteTrack(points,distances,rawTotalKm),
    places:createMunicipalityPlaces(points,distances,rawTotalKm,municipalityCells)
  };
}

routeImportButton.addEventListener('click',()=>routeImportFile.click());
routeImportFile.addEventListener('change',async()=>{
  const file=routeImportFile.files[0];
  if(!file)return;
  routeImportButton.disabled=true;
  routeImportStatus.textContent='GPX en gemeentegrenzen worden verwerkt…';
  try {
    const routeData=await createRouteData(file);
    await RouteStorage.save(routeData);
    routeImportStatus.textContent=
      `Route opgeslagen in de browsercache (${routeData.route.length} routepunten, `+
      `${routeData.places.length} gemeentevakken). Het dashboard wordt geladen.`;
    location.reload();
  } catch(error) {
    console.error('De GPX-import is mislukt.',error);
    routeImportStatus.textContent=error.message||'De GPX-import is mislukt.';
  } finally {
    routeImportButton.disabled=false;
    routeImportFile.value='';
  }
});
