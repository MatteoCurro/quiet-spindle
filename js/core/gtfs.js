/* Unlock Venice Transit — pure GTFS / geometry utilities
   No DOM, network, localStorage or Leaflet dependencies. */
(function(global){
  'use strict';

  function clamp(x,a,b){ return Math.max(a,Math.min(b,x)); }

  function parseCSV(text){
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quoted){
        if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
        else if(c==='"')quoted=false;else cell+=c;
      }else{
        if(c==='"')quoted=true;
        else if(c===','){row.push(cell);cell='';}
        else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}
        else cell+=c;
      }
    }
    if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
    const head=rows.shift()||[];
    return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(head.map((h,i)=>[h,r[i]??''])));
  }

  function distanceM(a,b){
    const lat=((a.lat+b.lat)/2)*Math.PI/180;
    const dx=(b.lon-a.lon)*111320*Math.cos(lat),dy=(b.lat-a.lat)*110540;
    return Math.hypot(dx,dy);
  }

  function prepareShape(points){
    points.sort((a,b)=>a.seq-b.seq);
    const cum=[0];
    for(let i=1;i<points.length;i++)cum.push(cum[i-1]+distanceM(points[i-1],points[i]));
    return {pts:points,cum,total:cum[cum.length-1]||0};
  }

  function pointAt(shape,p){
    if(!shape||shape.pts.length<2)return null;
    p=clamp(p,0,shape.total);
    let lo=0,hi=shape.cum.length-1;
    while(lo<hi){
      const mid=Math.ceil((lo+hi)/2);
      if(shape.cum[mid]<=p)lo=mid;else hi=mid-1;
    }
    const i=Math.min(lo,shape.pts.length-2),a=shape.pts[i],b=shape.pts[i+1];
    const seg=Math.max(.001,shape.cum[i+1]-shape.cum[i]),t=clamp((p-shape.cum[i])/seg,0,1);
    return {lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t};
  }

  function bearingAt(shape,p){
    const a=pointAt(shape,p),b=pointAt(shape,p+6);
    if(!a||!b)return 0;
    const p1=a.lat*Math.PI/180,p2=b.lat*Math.PI/180,dl=(b.lon-a.lon)*Math.PI/180;
    const y=Math.sin(dl)*Math.cos(p2);
    const x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }

  function projectToShape(shape,pos){
    if(!shape||shape.pts.length<2)return null;
    let best=null;
    const lat0=pos.lat*Math.PI/180,mx=111320*Math.cos(lat0),my=110540;
    for(let i=0;i<shape.pts.length-1;i++){
      const a=shape.pts[i],b=shape.pts[i+1];
      const ax=(a.lon-pos.lon)*mx,ay=(a.lat-pos.lat)*my;
      const bx=(b.lon-pos.lon)*mx,by=(b.lat-pos.lat)*my;
      const vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy||1;
      let t=-(ax*vx+ay*vy)/den;t=clamp(t,0,1);
      const x=ax+vx*t,y=ay+vy*t,d=Math.hypot(x,y);
      if(!best||d<best.distance){
        best={distance:d,progress:shape.cum[i]+(shape.cum[i+1]-shape.cum[i])*t,
              point:{lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t}};
      }
    }
    return best;
  }

  function simplify(points,toleranceM){
    if(points.length<=2)return points;
    const lat0=points[Math.floor(points.length/2)].lat*Math.PI/180;
    const mx=111320*Math.cos(lat0),my=110540;
    function sqSegDist(p,a,b){
      let x=a.lon*mx,y=a.lat*my,dx=(b.lon-a.lon)*mx,dy=(b.lat-a.lat)*my;
      const px=p.lon*mx,py=p.lat*my;
      if(dx||dy){
        const t=((px-x)*dx+(py-y)*dy)/(dx*dx+dy*dy);
        if(t>1){x=b.lon*mx;y=b.lat*my;}
        else if(t>0){x+=dx*t;y+=dy*t;}
      }
      dx=px-x;dy=py-y;return dx*dx+dy*dy;
    }
    const sqTol=toleranceM*toleranceM,out=[points[0]];
    function step(first,last){
      let maxSq=sqTol,index=-1;
      for(let i=first+1;i<last;i++){
        const sq=sqSegDist(points[i],points[first],points[last]);
        if(sq>maxSq){index=i;maxSq=sq;}
      }
      if(index!==-1){
        if(index-first>1)step(first,index);
        out.push(points[index]);
        if(last-index>1)step(index,last);
      }
    }
    step(0,points.length-1);out.push(points[points.length-1]);return out;
  }

  global.UVTransitGTFS=Object.freeze({clamp,parseCSV,distanceM,prepareShape,pointAt,bearingAt,projectToShape,simplify});
})(window);
