(() => {
  const TICKETS = 'salon-paper-tickets-v1';
  const NEXT = 'salon-next-ticket-number-v1';
  const SETTINGS = ['salon-service-prices-v1', 'salon-custom-services-v1', 'salon-deleted-services-v1', 'salon-color-supplies-v1', 'salon-service-specialties-v1'];
  const SUPPLY_REQUIREMENTS = 'salon-service-requires-supplies-v1';
  const SERVICE_SPECIALTIES = 'salon-service-specialties-v1';
  const requirementsFromSettings = () => {
    try {
      const specialties = JSON.parse(state.settings[SERVICE_SPECIALTIES] || '{}');
      return specialties && typeof specialties === 'object' && !Array.isArray(specialties) && specialties.__requiresSupplies && typeof specialties.__requiresSupplies === 'object' && !Array.isArray(specialties.__requiresSupplies) ? specialties.__requiresSupplies : {};
    } catch {return {}}
  };
  const MIGRATED = 'salon-ticket-server-migrated-v2';
  let state = {tickets: [], nextTicketNumber: 0, settings: {}};
  let pending = 0;
  let queue = Promise.resolve();
  const changed = () => document.dispatchEvent(new Event('salon-tickets-updated'));
  const request = async (method, body) => {
    const response = await fetch('/ticket-state', {method, cache: 'no-store', headers: method === 'POST' ? {'content-type': 'application/json'} : undefined, body: method === 'POST' ? JSON.stringify(body) : undefined});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudieron sincronizar los tickets.');
    return result;
  };
  const refresh = async () => {
    if (pending) return;
    try {
      const fresh = await request('GET');
      if (!pending && JSON.stringify(fresh) !== JSON.stringify(state)) {state = fresh; changed();}
    } catch { /* Se reintentará cuando vuelva la conexión. */ }
  };
  const legacy = () => {
    const settings = {};
    for (const key of SETTINGS) {
      const value = window.localStorage.getItem(key);
      if (value !== null) settings[key] = value;
    }
    let upsert = [];
    try {
      const value = JSON.parse(window.localStorage.getItem(TICKETS) || '[]');
      if (Array.isArray(value)) upsert = value.filter(ticket => ticket && typeof ticket.id === 'string').map(ticket => ({...ticket, ticketGroupId: ticket.ticketGroupId || ticket.id}));
    } catch { /* No hay tickets locales para importar. */ }
    return {action: 'migrate', upsert, deleteIds: [], settings};
  };
  const ready = (async () => {
    state = await request('GET');
    if (window.localStorage.getItem(MIGRATED) !== '1') {
      state = await request('POST', legacy());
      window.localStorage.setItem(MIGRATED, '1');
    }
    changed();
    setInterval(refresh, 2000);
    document.addEventListener?.('visibilitychange', () => {if (!document.hidden) void refresh()});
    window.addEventListener?.('focus', () => {void refresh()});
    window.addEventListener?.('pageshow', () => {void refresh()});
    window.addEventListener?.('online', () => {void refresh()});
    if (typeof EventSource !== 'undefined') {
      const events = new EventSource('/events');
      events.addEventListener('tickets', () => {void refresh()});
      events.addEventListener('ticket-activity', event => {
        try {
          const activity = JSON.parse(event.data);
          if (['open', 'finalized'].includes(activity?.status) && typeof activity.workerName === 'string') document.dispatchEvent(new CustomEvent('salon-ticket-activity', {detail: activity}));
        } catch { /* Se ignoran avisos inválidos. */ }
      });
    }
  })();
  const save = (body, rollbackState) => {
    pending++;
    queue = queue.catch(() => {}).then(async () => {
      try {
        const fresh = await request('POST', body);
        if (pending === 1) {state = fresh; changed();}
        return true;
      } catch (error) {
        try {state = await request('GET'); changed();}
        catch {if (rollbackState) {state = rollbackState; changed();}}
        alert(`${error.message} Comprueba el servidor y vuelve a intentar el cambio.`);
        return false;
      } finally {pending--;}
    });
    return queue;
  };
  window.salonTicketStorage = {
    ready,
    getItem(key) {
      if (key === TICKETS) return JSON.stringify(state.tickets);
      if (key === NEXT) return String(state.nextTicketNumber);
      if (key === SUPPLY_REQUIREMENTS) return JSON.stringify(requirementsFromSettings());
      return state.settings[key] ?? null;
    },
    setItem(key, value, activity) {
      if (key === NEXT) return;
      if (key === TICKETS) {
        const tickets = JSON.parse(String(value));
        if (!Array.isArray(tickets)) throw new Error('Tickets inválidos.');
        const before = new Map(state.tickets.map(ticket => [ticket.id, ticket]));
        const after = new Map(tickets.map(ticket => [ticket.id, ticket]));
        const upsert = tickets.filter(ticket => JSON.stringify(before.get(ticket.id)) !== JSON.stringify(ticket));
        const deleteIds = [...before.keys()].filter(id => !after.has(id));
        if (!upsert.length && !deleteIds.length) return Promise.resolve(true);
        const previous = state;
        state = {...state, tickets};
        return save({action: 'changes', upsert, deleteIds, settings: {}, ...(activity ? {activity} : {})}, previous);
      } else if (key === SUPPLY_REQUIREMENTS) {
        const requirements = JSON.parse(String(value));
        if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new Error('Configuración de insumos inválida.');
        let specialties;
        try {specialties = JSON.parse(state.settings[SERVICE_SPECIALTIES] || '{}')} catch {specialties = {}}
        if (!specialties || typeof specialties !== 'object' || Array.isArray(specialties)) specialties = {};
        const serialized = JSON.stringify({...specialties, __requiresSupplies: requirements});
        const previous = state;
        state = {...state, settings: {...state.settings, [SERVICE_SPECIALTIES]: serialized}};
        return save({action: 'changes', upsert: [], deleteIds: [], settings: {[SERVICE_SPECIALTIES]: serialized}}, previous);
      } else if (SETTINGS.includes(key)) {
        const serialized = String(value);
        JSON.parse(serialized);
        const previous = state;
        state = {...state, settings: {...state.settings, [key]: serialized}};
        return save({action: 'changes', upsert: [], deleteIds: [], settings: {[key]: serialized}}, previous);
      }
    }
  };
})();
