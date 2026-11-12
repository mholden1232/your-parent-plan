// Your Parent Plan: saves each page's information to the signed-in account.
// Load after auth.js. Pages call window.yppStore.load(section) / save(section, data).
//
// - Signed in: data is saved to the Supabase table public.plan_data.
// - Supabase not reachable/configured: data is kept in this browser only,
//   and a note in the top bar says so.
// - Older versions kept the checklist and Care facilities in this browser.
//   The first time a signed-in account loads with nothing saved yet, that
//   browser copy is uploaded to the account and then removed from the browser.
(function(){
  const LOCAL_PREFIX = 'ypp-local-';
  const SAVE_DELAY = 700;
  const pending = {};   // section -> {timer, data}
  let userPromise = null;
  let statusEl = null;
  let failed = false;

  function client(){ return window.yppAuthClient || null; }

  function getUser(){
    if(!userPromise){
      userPromise = (async ()=>{
        const c = client();
        if(!c) return null;
        try{
          const {data} = await c.auth.getSession();
          return data && data.session ? data.session.user : null;
        }catch(e){ return null; }
      })();
    }
    return userPromise;
  }

  function readLocal(key){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }catch(e){ return null; }
  }
  function writeLocal(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  }
  function removeLocal(key){
    try{ localStorage.removeItem(key); }catch(e){}
  }

  function status(text, kind){
    if(!statusEl){
      const bar = document.querySelector('.app-topbar');
      if(!bar) return;
      statusEl = document.createElement('div');
      statusEl.className = 'save-status';
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      const action = bar.querySelector('.quick-action');
      bar.insertBefore(statusEl, action || null);
    }
    statusEl.textContent = text;
    statusEl.dataset.kind = kind || '';
  }

  // Returns the saved data for a section (or null if nothing is saved).
  // opts.legacyKey: an older localStorage key to migrate from.
  // opts.legacyMap: converts the legacy value into the new shape.
  async function load(section, opts){
    opts = opts || {};
    const legacy = opts.legacyKey ? readLocal(opts.legacyKey) : null;
    const legacyData = legacy == null ? null : (opts.legacyMap ? opts.legacyMap(legacy) : legacy);
    const c = client();

    if(!c){
      return readLocal(LOCAL_PREFIX + section) || legacyData;
    }
    const user = await getUser();
    if(!user) return null; // auth.js will send the visitor to log in

    const {data, error} = await c
      .from('plan_data')
      .select('data')
      .eq('user_id', user.id)
      .eq('section', section)
      .maybeSingle();

    if(error){
      console.warn('Could not load', section, error.message);
      failed = true;
      status('Couldn’t load your saved information. Check your connection and reload.', 'error');
      return null;
    }
    if(data) {
      if(opts.legacyKey) removeLocal(opts.legacyKey);
      return data.data;
    }
    if(legacyData){
      const ok = await saveNow(section, legacyData);
      if(ok) removeLocal(opts.legacyKey);
      return legacyData;
    }
    return null;
  }

  async function saveNow(section, data){
    const c = client();
    if(!c){
      writeLocal(LOCAL_PREFIX + section, data);
      status('Saved on this device only', 'local');
      return true;
    }
    const user = await getUser();
    if(!user) return false;
    status('Saving…', 'saving');
    const {error} = await c.from('plan_data').upsert({
      user_id: user.id,
      section,
      data,
      updated_at: new Date().toISOString()
    }, {onConflict: 'user_id,section'});
    if(error){
      console.warn('Could not save', section, error.message);
      status('Not saved. Check your connection; we’ll try again on your next change.', 'error');
      return false;
    }
    if(!hasPending()) status('All changes saved', 'saved');
    return true;
  }

  function hasPending(){ return Object.keys(pending).length > 0; }

  // Debounced save: call on every change.
  function save(section, data){
    if(failed) return; // never overwrite saved data we could not load
    const p = pending[section] || (pending[section] = {});
    p.data = data;
    clearTimeout(p.timer);
    status('Saving…', 'saving');
    p.timer = setTimeout(()=>flush(section), SAVE_DELAY);
  }

  function flush(section){
    const p = pending[section];
    if(!p) return Promise.resolve(true);
    clearTimeout(p.timer);
    delete pending[section];
    return saveNow(section, p.data);
  }
  function flushAll(){ return Promise.all(Object.keys(pending).map(flush)); }

  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('beforeunload', e=>{
    if(hasPending()){ flushAll(); e.preventDefault(); e.returnValue = ''; }
  });

  // Fill and auto-save every [data-key] field inside a container.
  async function bindFields(container, section, onLoaded){
    if(!container) return;
    const fields = [...container.querySelectorAll('[data-key]')];
    const saved = (await load(section)) || {};
    fields.forEach(f=>{
      if(saved[f.dataset.key] !== undefined) f.value = saved[f.dataset.key];
    });
    if(onLoaded) onLoaded(saved);
    container.addEventListener('input', e=>{
      if(!e.target.matches('[data-key]')) return;
      const data = Object.assign({}, saved);
      fields.forEach(f=>{ data[f.dataset.key] = f.value; });
      Object.assign(saved, data);
      save(section, saved);
    });
    return saved;
  }

  // Shared profile: the parent's name appears in the sidebar and top bar.
  async function showParentName(){
    if(!document.body.dataset.authRequired) return;
    const profile = await load('profile');
    const name = profile && profile.parentName && profile.parentName.trim();
    if(!name) return;
    document.querySelectorAll('.app-profile b, .app-topbar .context[data-parent-name]').forEach(el=>{ el.textContent = name; });
  }

  window.yppStore = {load, save, saveNow, flushAll, bindFields};
  document.addEventListener('DOMContentLoaded', showParentName);
})();
