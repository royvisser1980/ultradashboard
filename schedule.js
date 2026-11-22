function localIso(date) {
  const pad=n=>String(n).padStart(2,'0');
  const normalized=new Date(date);
  if(normalized.getMilliseconds()>=998)normalized.setMilliseconds(1000);
  const milliseconds=normalized.getMilliseconds();
  return `${normalized.getFullYear()}-${pad(normalized.getMonth()+1)}-${pad(normalized.getDate())}T${pad(normalized.getHours())}:${pad(normalized.getMinutes())}:${pad(normalized.getSeconds())}${milliseconds?'.'+String(milliseconds).padStart(3,'0'):''}`
}

function buildSchedule(config,start,totalKm) {
  const segments=[],pauses=[];
  let now=new Date(start);
  let km=0;
  let segmentStartKm=0;
  let segmentStartTime=now;
  let rideMilliseconds=0;
  const mealBreakDates=new Set();
  const sleepBreakDates=new Set();
  const shortBreakMilliseconds=config.shortBreak.rideHours*60*60*1000;
  const sleepStartMinute=config.sleepBreak.startMinute||0;
  const sleepEndAt=startTime=>new Date(startTime.getTime()+config.sleepBreak.minutes*60*1000);

  const speedAt=k=> {
    const zone=config.speedZones.find(zone=>k>=zone.fromKm&&(zone.toKm===null||k<zone.toKm));
    return zone.kmPerHour
  };

  const closeSegment=(endKm,endTime)=> {
    if(endKm<=segmentStartKm)return;
    segments.push({
      k0:segmentStartKm,
      k1:endKm,
      t0:localIso(segmentStartTime),
      t1:localIso(endTime)
    })
  };

  while(km<totalKm) {
    const remainingKm=totalKm-km;
    const speed=speedAt(km);
    const finishMilliseconds=(remainingKm/speed)*60*60*1000;
    const candidates=[
      {type:'finish',milliseconds:finishMilliseconds}
    ];

    const toShort=shortBreakMilliseconds-rideMilliseconds;
    if(toShort>=0)candidates.push({type:'short',milliseconds:toShort});

    const meal=new Date(now);
    meal.setHours(config.mealBreak.hour,config.mealBreak.minute,0,0);
    if(meal<=now)meal.setDate(meal.getDate()+1);
    candidates.push({type:'meal',milliseconds:meal-now})

    const sleepDateKey=()=> {
      const sleep=new Date(now);
      sleep.setHours(config.sleepBreak.startHour,sleepStartMinute,0,0);
      if(sleep<=now)sleep.setDate(sleep.getDate()+1);
      return `${sleep.getFullYear()}-${sleep.getMonth()+1}-${sleep.getDate()}`
    };
    if(remainingKm>config.sleepBreak.minimumRemainingKm&&!sleepBreakDates.has(sleepDateKey())) {
      const sleep=new Date(now);
      sleep.setHours(config.sleepBreak.startHour,sleepStartMinute,0,0);
      if(sleep<=now)sleep.setDate(sleep.getDate()+1);
      candidates.push({type:'sleep',milliseconds:sleep-now})
    }

    for(const zone of config.speedZones) {
      if(zone.toKm!==null&&km>=zone.fromKm&&km<zone.toKm) {
        const boundaryMilliseconds=((zone.toKm-km)/speed)*60*60*1000;
        candidates.push({type:'boundary',milliseconds:boundaryMilliseconds,boundaryKm:zone.toKm})
      }
    }

    const next=candidates.sort((a,b)=>a.milliseconds-b.milliseconds)[0];

    if(next.type==='finish') {
      const finishTime=new Date(now.getTime()+next.milliseconds);
      closeSegment(totalKm,finishTime);
      now=finishTime;
      km=totalKm;
      break
    }

    if(next.type==='boundary') {
      const elapsed=next.milliseconds;
      const endTime=new Date(now.getTime()+elapsed);
      closeSegment(next.boundaryKm,endTime);
      km=next.boundaryKm;
      now=endTime;
      rideMilliseconds+=elapsed;
      segmentStartKm=km;
      segmentStartTime=now
    } else {
      const elapsed=next.milliseconds;
      const endKm=km+(speed*elapsed)/(60*60*1000);
      const endTime=new Date(now.getTime()+elapsed);
      const pauseStartTime=new Date(endTime);
      const overlappingMeal=!mealBreakDates.has(`${endTime.getFullYear()}-${endTime.getMonth()+1}-${endTime.getDate()}`)&&
        endTime.getHours()===config.mealBreak.hour&&
        endTime.getMinutes()===config.mealBreak.minute&&
        next.type!=='meal';
      const sleepDateKeyAtEnd=`${endTime.getFullYear()}-${endTime.getMonth()+1}-${endTime.getDate()}`;
      const overlappingSleep=!sleepBreakDates.has(sleepDateKeyAtEnd)&&
        endTime.getHours()===config.sleepBreak.startHour&&
        endTime.getMinutes()===sleepStartMinute&&
        (totalKm-endKm)>config.sleepBreak.minimumRemainingKm&&
        next.type!=='sleep';
      closeSegment(endKm,endTime);
      km=endKm;
      now=endTime;
      rideMilliseconds+=elapsed;
      segmentStartKm=km;
      segmentStartTime=now;

      if(next.type==='meal') {
        mealBreakDates.add(`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`);
        pauses.push({
          km,
          time:localIso(now),
          minutes:config.mealBreak.minutes,
          type:'Avondpauze'
        });
        now=new Date(now.getTime()+config.mealBreak.minutes*60*1000);
        rideMilliseconds=0
      } else if(next.type==='sleep') {
        sleepBreakDates.add(`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`);
        const sleepEnd=sleepEndAt(now);
        pauses.push({
          km,
          time:localIso(now),
          end:localIso(sleepEnd),
          minutes:config.sleepBreak.minutes,
          type:'Slaapstop'
        });
        now=sleepEnd;
        rideMilliseconds=0
      } else if(next.type==='short') {
        pauses.push({
          km,
          time:localIso(now),
          minutes:config.shortBreak.minutes,
          type:'Korte pauze'
        });
        const sleepAt=new Date(pauseStartTime);
        sleepAt.setHours(config.sleepBreak.startHour,sleepStartMinute,0,0);
        if(sleepAt<=pauseStartTime)sleepAt.setDate(sleepAt.getDate()+1);
        const shortEnd=new Date(now.getTime()+config.shortBreak.minutes*60*1000);
        const sleepDate=`${sleepAt.getFullYear()}-${sleepAt.getMonth()+1}-${sleepAt.getDate()}`;
        const remainingAtSleep=totalKm-km;
        if(shortEnd>=sleepAt&&sleepAt>=pauseStartTime&&
           !sleepBreakDates.has(sleepDate)&&
           remainingAtSleep>config.sleepBreak.minimumRemainingKm) {
          sleepBreakDates.add(sleepDate);
          const sleepEnd=sleepEndAt(sleepAt);
          pauses.push({
            km,
            time:localIso(sleepAt),
            end:localIso(sleepEnd),
            minutes:config.sleepBreak.minutes,
            type:'Slaapstop'
          });
          now=sleepEnd
        } else {
          now=shortEnd
        }
        rideMilliseconds=0
      }
      if(overlappingMeal) {
        mealBreakDates.add(`${endTime.getFullYear()}-${endTime.getMonth()+1}-${endTime.getDate()}`);
        pauses.push({
          km,
          time:localIso(endTime),
          minutes:config.mealBreak.minutes,
          type:'Avondpauze'
        });
        now=new Date(now.getTime()+config.mealBreak.minutes*60*1000);
        rideMilliseconds=0
      }
      if(overlappingSleep) {
        sleepBreakDates.add(sleepDateKeyAtEnd);
        const sleepEnd=sleepEndAt(endTime);
        pauses.push({
          km,
          time:localIso(endTime),
          end:localIso(sleepEnd),
          minutes:config.sleepBreak.minutes,
          type:'Slaapstop'
        });
        now=sleepEnd;
        rideMilliseconds=0
      }
      segmentStartKm=km;
      segmentStartTime=now
    }
  }

  return {segments,pauses,finish:localIso(now)}
}
