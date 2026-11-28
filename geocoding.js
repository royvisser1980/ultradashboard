const Geocoding=(()=>{
  const REQUEST_INTERVAL_MS=1500;
  let lastRequestAt=0;

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

  async function search(address) {
    const delay=Math.max(0,REQUEST_INTERVAL_MS-(Date.now()-lastRequestAt));
    if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
    lastRequestAt=Date.now();
    const url=new URL('https://nominatim.openstreetmap.org/search');
    url.search=new URLSearchParams({format:'jsonv2',limit:'1',q:address}).toString();
    const response=await fetch(url);
    if(!response.ok)throw new Error(`Nominatim gaf een fout terug (${response.status}).`);
    const results=await response.json();
    if(!Array.isArray(results)||results.length===0) {
      throw new Error('Nominatim vond geen locatie. Controleer het adres en probeer het opnieuw.');
    }
    const result=results[0];
    if(!result||result.lat==null||result.lon==null||
       String(result.lat).trim()===''||String(result.lon).trim()==='') {
      throw new Error('Nominatim gaf ongeldige coördinaten terug.');
    }
    const longitude=Number(result.lon),latitude=Number(result.lat);
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90) {
      throw new Error('Nominatim gaf ongeldige coördinaten terug.');
    }
    return {latitude,longitude};
  }

  return Object.freeze({normalizeAddress,search});
})();
