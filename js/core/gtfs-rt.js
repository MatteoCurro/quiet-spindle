/* U.Venice Transport — minimal GTFS-Realtime protobuf decoder.
   Decodes only the standard fields consumed by the ACTV adapter. Unknown
   fields are skipped so newer GTFS-RT producers remain forward-compatible. */
(function(global){
  'use strict';

  function Reader(input){
    this.buf=input instanceof Uint8Array?input:new Uint8Array(input||0);
    this.pos=0;this.len=this.buf.length;
    this.view=new DataView(this.buf.buffer,this.buf.byteOffset,this.buf.byteLength);
  }
  Reader.prototype.eof=function(){return this.pos>=this.len};
  Reader.prototype.varintBig=function(){
    let out=0n,shift=0n;
    for(let i=0;i<10;i++){
      if(this.pos>=this.len)throw new Error('GTFS-RT protobuf troncato');
      const b=BigInt(this.buf[this.pos++]);
      out|=(b&0x7fn)<<shift;
      if((b&0x80n)===0n)return out;
      shift+=7n;
    }
    throw new Error('GTFS-RT varint non valido');
  };
  Reader.prototype.uint=function(){return Number(this.varintBig())};
  Reader.prototype.int32=function(){return Number(BigInt.asIntN(32,this.varintBig()))};
  Reader.prototype.bool=function(){return this.uint()!==0};
  Reader.prototype.float=function(){
    if(this.pos+4>this.len)throw new Error('GTFS-RT float troncato');
    const v=this.view.getFloat32(this.pos,true);this.pos+=4;return v;
  };
  Reader.prototype.double=function(){
    if(this.pos+8>this.len)throw new Error('GTFS-RT double troncato');
    const v=this.view.getFloat64(this.pos,true);this.pos+=8;return v;
  };
  Reader.prototype.bytes=function(){
    const n=this.uint(),end=this.pos+n;
    if(end>this.len)throw new Error('GTFS-RT campo length-delimited troncato');
    const out=this.buf.subarray(this.pos,end);this.pos=end;return out;
  };
  Reader.prototype.string=function(){return new TextDecoder('utf-8').decode(this.bytes())};
  Reader.prototype.sub=function(){return new Reader(this.bytes())};
  Reader.prototype.skip=function(wire){
    if(wire===0){this.varintBig();return}
    if(wire===1){this.pos+=8}
    else if(wire===2){const n=this.uint();this.pos+=n}
    else if(wire===5){this.pos+=4}
    else throw new Error('GTFS-RT wire type non supportato: '+wire);
    if(this.pos>this.len)throw new Error('GTFS-RT skip oltre buffer');
  };

  function fields(reader,handler){
    while(!reader.eof()){
      const tag=reader.uint(),field=tag>>>3,wire=tag&7;
      if(!field)throw new Error('GTFS-RT tag non valido');
      if(handler(field,wire,reader)===false)reader.skip(wire);
    }
  }

  function decodeHeader(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.gtfsRealtimeVersion=x.string();return true}
      if(f===2&&w===0){o.incrementality=x.uint();return true}
      if(f===3&&w===0){o.timestamp=x.uint();return true}
      return false;
    });return o;
  }
  function decodeTripDescriptor(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.tripId=x.string();return true}
      if(f===2&&w===2){o.startTime=x.string();return true}
      if(f===3&&w===2){o.startDate=x.string();return true}
      if(f===4&&w===0){o.scheduleRelationship=x.uint();return true}
      if(f===5&&w===2){o.routeId=x.string();return true}
      if(f===6&&w===0){o.directionId=x.uint();return true}
      return false;
    });return o;
  }
  function decodeVehicleDescriptor(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.id=x.string();return true}
      if(f===2&&w===2){o.label=x.string();return true}
      if(f===3&&w===2){o.licensePlate=x.string();return true}
      if(f===4&&w===0){o.wheelchairAccessible=x.uint();return true}
      return false;
    });return o;
  }
  function decodePosition(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===5){o.latitude=x.float();return true}
      if(f===2&&w===5){o.longitude=x.float();return true}
      if(f===3&&w===5){o.bearing=x.float();return true}
      if(f===4&&w===1){o.odometer=x.double();return true}
      if(f===5&&w===5){o.speed=x.float();return true}
      return false;
    });return o;
  }
  function decodeStopTimeEvent(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===0){o.delay=x.int32();return true}
      if(f===2&&w===0){o.time=x.uint();return true}
      if(f===3&&w===0){o.uncertainty=x.int32();return true}
      if(f===4&&w===0){o.scheduledTime=x.uint();return true}
      return false;
    });return o;
  }
  function decodeStopTimeProperties(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.assignedStopId=x.string();return true}
      return false;
    });return o;
  }
  function decodeStopTimeUpdate(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===0){o.stopSequence=x.uint();return true}
      if(f===2&&w===2){o.arrival=decodeStopTimeEvent(x.sub());return true}
      if(f===3&&w===2){o.departure=decodeStopTimeEvent(x.sub());return true}
      if(f===4&&w===2){o.stopId=x.string();return true}
      if(f===5&&w===0){o.scheduleRelationship=x.uint();return true}
      if(f===6&&w===2){o.stopTimeProperties=decodeStopTimeProperties(x.sub());return true}
      return false;
    });return o;
  }
  function decodeTripUpdate(r){
    const o={stopTimeUpdate:[]};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.trip=decodeTripDescriptor(x.sub());return true}
      if(f===2&&w===2){o.stopTimeUpdate.push(decodeStopTimeUpdate(x.sub()));return true}
      if(f===3&&w===2){o.vehicle=decodeVehicleDescriptor(x.sub());return true}
      if(f===4&&w===0){o.timestamp=x.uint();return true}
      if(f===5&&w===0){o.delay=x.int32();return true}
      return false;
    });return o;
  }
  function decodeVehiclePosition(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.trip=decodeTripDescriptor(x.sub());return true}
      if(f===2&&w===2){o.position=decodePosition(x.sub());return true}
      if(f===3&&w===0){o.currentStopSequence=x.uint();return true}
      if(f===4&&w===0){o.currentStatus=x.uint();return true}
      if(f===5&&w===0){o.timestamp=x.uint();return true}
      if(f===6&&w===0){o.congestionLevel=x.uint();return true}
      if(f===7&&w===2){o.stopId=x.string();return true}
      if(f===8&&w===2){o.vehicle=decodeVehicleDescriptor(x.sub());return true}
      if(f===9&&w===0){o.occupancyStatus=x.uint();return true}
      if(f===10&&w===0){o.occupancyPercentage=x.uint();return true}
      return false;
    });return o;
  }
  function decodeEntity(r){
    const o={};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.id=x.string();return true}
      if(f===2&&w===0){o.isDeleted=x.bool();return true}
      if(f===3&&w===2){o.tripUpdate=decodeTripUpdate(x.sub());return true}
      if(f===4&&w===2){o.vehicle=decodeVehiclePosition(x.sub());return true}
      return false;
    });return o;
  }
  function decodeFeed(input){
    const r=new Reader(input),o={entity:[]};
    fields(r,(f,w,x)=>{
      if(f===1&&w===2){o.header=decodeHeader(x.sub());return true}
      if(f===2&&w===2){o.entity.push(decodeEntity(x.sub()));return true}
      return false;
    });
    if(!o.header)o.header={};
    return o;
  }

  global.UVTransitGTFSRT=Object.freeze({decodeFeed});
})(window);
