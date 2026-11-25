(function(global) {
  const SETTINGS_STORAGE_KEY='ultradashboard.settings';
  const LEGACY_START_STORAGE_KEY='ultradashboard.startTime';

  function defaultScenarios(schedules) {
    return [
      {id:'fast',name:'Snel schema',color:'#087f5b',config:schedules.fast.config},
      {id:'slow',name:'Langzaam schema',color:'#c2410c',config:schedules.slow.config}
    ];
  }

  function hasSpeedZones(config) {
    return Boolean(config&&Array.isArray(config.speedZones)&&config.speedZones.length>0);
  }

  global.DashboardCommon=Object.freeze({
    SETTINGS_STORAGE_KEY,
    LEGACY_START_STORAGE_KEY,
    defaultScenarios,
    hasSpeedZones
  });
})(window);
