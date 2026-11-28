const CheckpointData=(()=>{
  const DATABASE_NAME='ultradashboard.checkpoints';
  const STORE_NAME='checkpoints';
  const LIST_KEY='list';

  function openDatabase() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(DATABASE_NAME,1);
      request.onupgradeneeded=()=>{
        if(!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('De checkpointopslag kon niet worden geopend.'));
      request.onblocked=()=>reject(new Error('De checkpointopslag wordt geblokkeerd door een ander browsertabblad.'));
    });
  }

  function readAll(database) {
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,'readonly');
      const request=transaction.objectStore(STORE_NAME).get(LIST_KEY);
      let result=[];
      request.onsuccess=()=>{result=request.result===undefined?[]:request.result};
      request.onerror=()=>reject(request.error||new Error('De checkpoints konden niet worden gelezen.'));
      transaction.oncomplete=()=>{
        if(!Array.isArray(result))reject(new Error('De opgeslagen checkpointgegevens zijn ongeldig.'));
        else resolve(result);
      };
      transaction.onabort=()=>reject(transaction.error||new Error('De checkpoints konden niet worden gelezen.'));
    });
  }

  function replaceImported(database,checkpoints) {
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,'readwrite');
      const store=transaction.objectStore(STORE_NAME);
      const request=store.get(LIST_KEY);
      let result=null,failure=null;
      request.onsuccess=()=>{
        try {
          const existing=request.result===undefined?[]:request.result;
          if(!Array.isArray(existing))throw new Error('De opgeslagen checkpointgegevens zijn ongeldig.');
          const byAddress=new Map();
          for(const checkpoint of existing) {
            const address=Geocoding.normalizeAddress(checkpoint.address);
            if(address&&AccommodationData.hasCoordinates(checkpoint)&&!byAddress.has(address)) {
              byAddress.set(address,checkpoint);
            }
          }
          let importedCoordinateCount=0,preservedCoordinateCount=0;
          const importedAt=new Date().toISOString();
          const replacement=checkpoints.map(checkpoint=>{
            const imported=AccommodationData.getCoordinates(checkpoint);
            const previous=byAddress.get(Geocoding.normalizeAddress(checkpoint.address));
            if(imported)importedCoordinateCount++;
            else if(previous)preservedCoordinateCount++;
            return {
              ...checkpoint,
              latitude:imported?imported.latitude:previous?previous.latitude:null,
              longitude:imported?imported.longitude:previous?previous.longitude:null,
              geocodedAt:imported?importedAt:previous?previous.geocodedAt:null,
              geocoder:imported?'Excel import':previous?previous.geocoder:null
            };
          });
          store.put(replacement,LIST_KEY);
          result={checkpoints:replacement,importedCoordinateCount,preservedCoordinateCount};
        } catch(error) {
          failure=error;
          transaction.abort();
        }
      };
      request.onerror=()=>{failure=request.error||new Error('De checkpoints konden niet worden gelezen.')};
      transaction.oncomplete=()=>resolve(result);
      transaction.onabort=()=>reject(failure||transaction.error||new Error('De checkpoints konden niet worden opgeslagen.'));
      transaction.onerror=()=>reject(failure||transaction.error||new Error('De checkpoints konden niet worden opgeslagen.'));
    });
  }

  function setCoordinates(database,index,expected,coordinates) {
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,'readwrite');
      const store=transaction.objectStore(STORE_NAME);
      const request=store.get(LIST_KEY);
      let failure=null;
      request.onsuccess=()=>{
        try {
          const checkpoints=request.result;
          if(!Array.isArray(checkpoints))throw new Error('De opgeslagen checkpointgegevens zijn ongeldig.');
          const checkpoint=checkpoints[index];
          if(!checkpoint||checkpoint.name!==expected.name||checkpoint.address!==expected.address) {
            throw new Error('De checkpointlijst is ondertussen gewijzigd. Probeer opnieuw.');
          }
          if(AccommodationData.hasCoordinates(checkpoint)) {
            throw new Error('Dit checkpoint heeft ondertussen al coördinaten gekregen.');
          }
          checkpoints[index]={...checkpoint,...coordinates};
          store.put(checkpoints,LIST_KEY);
        } catch(error) {
          failure=error;
          transaction.abort();
        }
      };
      request.onerror=()=>{failure=request.error||new Error('De checkpoints konden niet worden gelezen.')};
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(failure||transaction.error||new Error('De coördinaten konden niet worden opgeslagen.'));
      transaction.onerror=()=>reject(failure||transaction.error||new Error('De coördinaten konden niet worden opgeslagen.'));
    });
  }

  return Object.freeze({openDatabase,readAll,replaceImported,setCoordinates});
})();
