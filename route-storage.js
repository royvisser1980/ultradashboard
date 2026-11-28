const RouteStorage=(()=>{
  const CACHE_NAME='ultradashboard-route-data-v1';
  const ROUTE_KEY=new URL('./route-data.json',document.baseURI).href;

  function validate(routeData) {
    if(!routeData||typeof routeData!=='object'||
       !Number.isFinite(routeData.total)||routeData.total<=0||
       !Array.isArray(routeData.route)||routeData.route.length<2||
       !Array.isArray(routeData.places)||routeData.places.length===0) {
      throw new Error('De opgeslagen routedata heeft een ongeldig formaat.');
    }
    let previousKm=-1;
    for(let i=0;i<routeData.route.length;i++) {
      const point=routeData.route[i];
      if(!Array.isArray(point)||point.length<4||
         !point.slice(0,4).every(Number.isFinite)||
         point[0]<0||point[0]<=previousKm||
         Math.abs(point[1])>180||Math.abs(point[2])>90) {
        throw new Error(`Routepunt ${i+1} bevat ongeldige gegevens.`);
      }
      previousKm=point[0];
    }
    if(Math.abs(previousKm-routeData.total)>0.01) {
      throw new Error('De totale routelengte komt niet overeen met het laatste routepunt.');
    }
    let previousPlaceKm=-1;
    for(let i=0;i<routeData.places.length;i++) {
      const place=routeData.places[i];
      if(!place||!Number.isFinite(place.km)||place.km<0||
         place.km>routeData.total+0.01||
         place.km<previousPlaceKm||typeof place.country!=='string'||
         !place.country||typeof place.name!=='string'||!place.name) {
        throw new Error(`Gemeentegrens ${i+1} bevat ongeldige gegevens.`);
      }
      previousPlaceKm=place.km;
    }
    return routeData;
  }

  async function getCache() {
    if(!('caches' in window)) {
      throw new Error('Deze browser ondersteunt geen Cache Storage voor routedata.');
    }
    return caches.open(CACHE_NAME);
  }

  async function load() {
    const cache=await getCache();
    const response=await cache.match(ROUTE_KEY);
    if(!response)return null;
    try {
      return validate(await response.json());
    } catch(error) {
      console.error('De routedata in de browsercache is ongeldig.',error);
      throw new Error(error.message||'De routedata in de browsercache kon niet worden gelezen.');
    }
  }

  async function save(routeData) {
    validate(routeData);
    const cache=await getCache();
    const response=new Response(JSON.stringify(routeData),{
      headers:{'Content-Type':'application/json'}
    });
    await cache.put(ROUTE_KEY,response);
  }

  return Object.freeze({load,save});
})();
