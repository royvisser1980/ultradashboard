if('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(error=>{
    console.error('De offlinevoorzieningen konden niet worden gestart.',error);
  });
}
