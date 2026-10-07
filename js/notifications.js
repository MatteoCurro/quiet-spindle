/* Unlock Venice Transit — notification center
   Presentation-agnostic store for service health, normalized transport alerts
   and transient UI messages. */
(function(global){
  'use strict';

  const listeners = new Set();

  const state = {
    service: {
      level: 'info',
      title: 'Connessione al servizio',
      message: 'Attendo il primo aggiornamento realtime.',
      visible: true,
      sticky: true
    },
    alerts: {
      status: 'idle',
      generatedAt: null,
      revision: null,
      sourceHealth: {},
      items: [],
      error: null
    },
    transient: []
  };

  function clone(){ return JSON.parse(JSON.stringify(state)); }

  function emit(){
    const snapshot = clone();
    listeners.forEach(fn => {
      try{ fn(snapshot); }catch(_){}
    });
  }

  function subscribe(fn){
    listeners.add(fn);
    try{ fn(clone()); }catch(_){}
    return () => listeners.delete(fn);
  }

  function setService(notification){
    state.service = Object.assign({}, state.service, notification || {});
    emit();
  }

  function clearService(){
    state.service.visible = false;
    emit();
  }

  function setAlerts(payload){
    const next=payload && typeof payload==='object' ? payload : {};
    state.alerts={
      status:next.status||'ready',
      generatedAt:next.generatedAt||null,
      revision:next.revision||null,
      sourceHealth:next.sourceHealth&&typeof next.sourceHealth==='object'?next.sourceHealth:{},
      items:Array.isArray(next.items)?next.items:Array.isArray(next.alerts)?next.alerts:[],
      error:next.error||null
    };
    emit();
  }

  function push(notification){
    const n = Object.assign({
      id: 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      level: 'info',
      title: '',
      message: '',
      ttl: 5000
    }, notification || {});
    state.transient.push(n);
    emit();

    if(n.ttl > 0){
      setTimeout(() => dismiss(n.id), n.ttl);
    }
    return n.id;
  }

  function dismiss(id){
    const i = state.transient.findIndex(n => n.id === id);
    if(i >= 0){
      state.transient.splice(i,1);
      emit();
    }
  }

  global.UVTransitNotifications = Object.freeze({
    subscribe,
    setService,
    clearService,
    setAlerts,
    push,
    dismiss
  });
})(window);
