(function(global) {
  function safeAccommodationWebsite(value) {
    if(typeof value!=='string')return null;
    try {
      const url=new URL(value,location.href);
      return url.protocol==='https:'||url.protocol==='http:'?url.href:null;
    } catch(error) {
      return null;
    }
  }

  function safeAccommodationPhone(value) {
    if(typeof value!=='string')return null;
    const phone=value.trim().replace(/\s*\(0\)/g,'').replace(/[^\d+]/g,'');
    return /^\+[1-9]\d{6,14}$/.test(phone)?`tel:${phone}`:null;
  }

  function toFeatures(hotels) {
    return hotels.flatMap(hotel=>{
      if(hotel.longitude===null||hotel.longitude===undefined||hotel.longitude===''||
         hotel.latitude===null||hotel.latitude===undefined||hotel.latitude==='')return [];
      const longitude=Number(hotel.longitude),latitude=Number(hotel.latitude);
      if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||
         Math.abs(longitude)>180||Math.abs(latitude)>90)return [];
      return [{
        type:'Feature',
        id:hotel.id,
        geometry:{type:'Point',coordinates:[longitude,latitude]},
        properties:{
          name:typeof hotel.name==='string'?hotel.name:'',
          address:typeof hotel.address==='string'?hotel.address:'',
          phone:typeof hotel.phone==='string'?hotel.phone:'',
          website:typeof hotel.website==='string'?hotel.website:'',
          extraInfo:typeof hotel.extraInfo==='string'?hotel.extraInfo:''
        }
      }];
    });
  }

  function popupContent(hotel) {
    const content=document.createElement('div');
    const name=document.createElement('strong');
    name.textContent=hotel.name||'Accommodatie';
    const address=document.createElement('p');
    address.textContent=hotel.address;
    content.append(name,address);

    const phoneUrl=safeAccommodationPhone(hotel.phone);
    if(phoneUrl) {
      const phone=document.createElement('p');
      const link=document.createElement('a');
      link.href=phoneUrl;
      link.textContent=hotel.phone;
      phone.append(link);
      content.append(phone);
    }
    if(hotel.extraInfo) {
      const extraInfo=document.createElement('p');
      extraInfo.textContent=hotel.extraInfo;
      content.append(extraInfo);
    }
    const websiteUrl=safeAccommodationWebsite(hotel.website);
    if(websiteUrl) {
      const link=document.createElement('a');
      link.href=websiteUrl;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.textContent=hotel.website;
      content.append(link);
    }
    return content;
  }

  function create(map,{sourceId,layerId,toggle=null,status}) {
    map.addSource(sourceId,{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({
      id:layerId,
      type:'circle',
      source:sourceId,
      paint:{
        'circle-radius':8,
        'circle-color':'#2563eb',
        'circle-stroke-color':'#fff',
        'circle-stroke-width':2
      }
    });
    const setVisibility=()=>{
      map.setLayoutProperty(layerId,'visibility',!toggle||toggle.checked?'visible':'none');
    };
    const setHotels=(hotels,fitToHotels=false)=>{
      const features=toFeatures(hotels);
      map.getSource(sourceId).setData({type:'FeatureCollection',features});
      setVisibility();
      status.textContent=features.length===0?
        'Er zijn nog geen opgeslagen accommodaties met geldige coördinaten.':
        `${features.length} ${features.length===1?'accommodatie':'accommodaties'} met coördinaten op de kaart.`;
      if(!fitToHotels)return;
      const locations=[...new Map(features.map(feature=>[
        feature.geometry.coordinates.join(','),
        feature.geometry.coordinates
      ])).values()];
      if(locations.length===1) {
        map.easeTo({center:locations[0],zoom:12,duration:0});
      } else if(locations.length>1) {
        const bounds=new maplibregl.LngLatBounds();
        locations.forEach(location=>bounds.extend(location));
        map.fitBounds(bounds,{padding:55,maxZoom:12,duration:0});
      }
    };
    map.on('click',layerId,event=>{
      const hotel=event.features&&event.features[0]&&event.features[0].properties;
      if(!hotel)return;
      new maplibregl.Popup()
        .setLngLat(event.lngLat)
        .setDOMContent(popupContent(hotel))
        .addTo(map);
    });
    map.on('mouseenter',layerId,()=>{map.getCanvas().style.cursor='pointer'});
    map.on('mouseleave',layerId,()=>{map.getCanvas().style.cursor=''});
    if(toggle)toggle.addEventListener('change',setVisibility);
    setVisibility();
    return {setHotels,setVisibility};
  }

  global.AccommodationMapLayer={
    create,
    safeAccommodationPhone,
    safeAccommodationWebsite
  };
})(window);
