const SpreadsheetUtils=(()=>{
  function text(value) {
    return value==null?'':String(value).trim();
  }

  function normalizeHeader(value) {
    return text(value).normalize('NFKC').toLocaleLowerCase('nl-NL');
  }

  function parseCoordinate(value,field,minimum,maximum,rowNumber) {
    const coordinateText=text(value).replace(/\s/g,'').replace(',','.');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(coordinateText)) {
      throw new Error(`Rij ${rowNumber}: "${field}" moet een getal tussen ${minimum} en ${maximum} zijn.`);
    }
    const coordinate=Number(coordinateText);
    if(!Number.isFinite(coordinate)||coordinate<minimum||coordinate>maximum) {
      throw new Error(`Rij ${rowNumber}: "${field}" moet een getal tussen ${minimum} en ${maximum} zijn.`);
    }
    return coordinate;
  }

  async function readRows(file,maximumRows,label) {
    if(!file.name.toLocaleLowerCase('nl-NL').endsWith('.xlsx')) {
      throw new Error('Selecteer een Excelbestand met de extensie .xlsx.');
    }
    if(file.size===0||file.size>5*1024*1024) {
      throw new Error('Het Excelbestand moet groter zijn dan 0 bytes en maximaal 5 MB zijn.');
    }
    if(typeof XLSX==='undefined') {
      throw new Error('De Excel-parser is niet geladen. Controleer de internetverbinding en probeer het opnieuw.');
    }
    const data=await file.arrayBuffer();
    const signature=new Uint8Array(data,0,Math.min(2,data.byteLength));
    if(signature[0]!==0x50||signature[1]!==0x4b) {
      throw new Error('Het bestand heeft geen geldige .xlsx-indeling.');
    }
    let workbook;
    try {
      workbook=XLSX.read(data,{
        type:'array',cellFormula:true,cellHTML:false,cellStyles:false,
        bookVBA:false,sheetRows:maximumRows+2
      });
    } catch(error) {
      throw new Error(`Het Excelbestand kon niet worden gelezen: ${error.message||'ongeldige bestandsinhoud'}`);
    }
    const sheetName=workbook.SheetNames[0];
    if(!sheetName)throw new Error('Het Excelbestand bevat geen werkblad.');
    const worksheet=workbook.Sheets[sheetName];
    if(Object.keys(worksheet).some(address=>
      !address.startsWith('!')&&worksheet[address]&&worksheet[address].f)) {
      throw new Error('Gebruik in het Excelbestand alleen vaste waarden, geen formules.');
    }
    const rows=XLSX.utils.sheet_to_json(worksheet,{
      header:1,defval:'',raw:false,blankrows:false
    });
    if(rows.length<2)throw new Error(`Het werkblad bevat geen ${label} onder de kolomkoppen.`);
    if(rows.length-1>maximumRows) {
      throw new Error(`Er kunnen maximaal ${maximumRows} ${label} tegelijk worden geïmporteerd.`);
    }
    return rows;
  }

  return Object.freeze({text,normalizeHeader,parseCoordinate,readRows});
})();
