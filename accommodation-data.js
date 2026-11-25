(function(global) {
  const DATABASE_NAME='ultradashboard.hotels';
  const DATABASE_VERSION=2;
  const STORE_NAME='hotels';
  const METADATA_STORE_NAME='metadata';

  function openDatabase(version) {
    return new Promise((resolve,reject)=>{
      const request=version===undefined?
        indexedDB.open(DATABASE_NAME):
        indexedDB.open(DATABASE_NAME,version);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME,{keyPath:'id'});
        }
        if(version!==undefined&&version>=DATABASE_VERSION&&
           !database.objectStoreNames.contains(METADATA_STORE_NAME)) {
          database.createObjectStore(METADATA_STORE_NAME,{keyPath:'key'});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('De opslag van accommodaties kon niet worden geopend.'));
      request.onblocked=()=>reject(new Error('De opslag van accommodaties wordt geblokkeerd door een ander browsertabblad.'));
    });
  }

  function readAllHotels(database) {
    return new Promise((resolve,reject)=>{
      const transaction=database.transaction(STORE_NAME,'readonly');
      const request=transaction.objectStore(STORE_NAME).getAll();
      let hotels=[];
      request.onsuccess=()=>{hotels=request.result||[]};
      request.onerror=()=>reject(request.error||new Error('De accommodaties konden niet uit browseropslag worden gelezen.'));
      transaction.oncomplete=()=>resolve(hotels);
      transaction.onabort=()=>reject(transaction.error||new Error('Het ophalen van de accommodaties is afgebroken.'));
    });
  }

  function getCoordinates(hotel) {
    if(hotel.longitude===null||hotel.longitude===undefined||hotel.longitude===''||
       hotel.latitude===null||hotel.latitude===undefined||hotel.latitude==='')return null;
    const longitude=Number(hotel.longitude),latitude=Number(hotel.latitude);
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||
       Math.abs(longitude)>180||Math.abs(latitude)>90)return null;
    return {longitude,latitude};
  }

  function hasCoordinates(hotel) {
    return Number.isFinite(hotel.latitude)&&Number.isFinite(hotel.longitude)&&
      Math.abs(hotel.latitude)<=90&&Math.abs(hotel.longitude)<=180;
  }

  global.AccommodationData=Object.freeze({
    DATABASE_VERSION,
    STORE_NAME,
    METADATA_STORE_NAME,
    openDatabase,
    readAllHotels,
    getCoordinates,
    hasCoordinates
  });
})(window);
