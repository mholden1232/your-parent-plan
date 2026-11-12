// Your Parent Plan: saves each page's information to the plan being viewed.
// Load after auth.js. Pages call window.yppStore.load(section) / save(section, data)
// and window.yppStore.plan() for who owns the plan and what this person can do.
//
// - Signed in: data is saved to the Supabase table public.plan_data, under the
//   plan owner's id. Family members invited to a plan read/write the owner's rows
//   (editors) or only read them (viewers). See supabase-family-setup.sql.
// - Supabase not reachable/configured: data is kept in this browser only,
//   and a note in the top bar says so.
// - Older versions kept the checklist and Care facilities in this browser.
//   The first time the owner signs in there with nothing saved yet, that
//   browser copy is uploaded to the account and then removed from the browser.
(function(){
  const LOCAL_PREFIX = 'ypp-local-';
  const ACTIVE_KEY = 'ypp-active-plan';
  const SAVE_DELAY = 700;
  const pending = {};   // section -> {timer, data}
  let planPromise = null;
  let statusEl = null;
  let failed = false;

  function client(){ return window.yppAuthClient || null; }

  function readLocal(key){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }catch(e){ return null; }
  }
  function writeLocal(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  }
  function removeLocal(key){
    try{ localStorage.removeItem(key); }catch(e){}
  }

  // Which plan is open, and what this person may do with it.
  // {user, ownerId, role: 'owner'|'editor'|'viewer', isOwn, canEdit, isPlus, shared:[...]}
  function plan(){
    if(!planPromise){
      planPromise = (async ()=>{
        const c = client();
        if(!c) return {user:null, ownerId:null, role:'owner', isOwn:true, canEdit:true, isPlus:false, shared:[], offline:true};
        let user = null;
        try{
          const {data} = await c.auth.getSession();
          user = data && data.session ? data.session.user : null;
        }catch(e){}
        if(!user) return null; // auth.js will send the visitor to log in

        let shared = [];
        try{
          const {data, error} = await c.rpc('ypp_shared_plans');
          if(!error && Array.isArray(data)) shared = data;
        }catch(e){}

        let wanted = null;
        try{ wanted = localStorage.getItem(ACTIVE_KEY); }catch(e){}
        const match = shared.find(p=>p.owner_id === wanted);
        const ownerId = match ? match.owner_id : user.id;
        const role = match ? match.role : 'owner';

        let isPlus = false;
        try{
          const {data, error} = await c.rpc('ypp_plan_is_plus', {owner: ownerId});
          if(!error) isPlus = !!data;
          else if(ownerId === user.id && window.yppGetMembership) isPlus = !!(await window.yppGetMembership()).isPlus;
        }catch(e){}

        return {user, ownerId, role, isOwn: ownerId === user.id, canEdit: role !== 'viewer', isPlus, shared,
                ownerEmail: match ? match.owner_email : user.email};
      })();
    }
    return planPromise;
  }

  function setActivePlan(ownerId){
    try{
      if(ownerId) localStorage.setItem(ACTIVE_KEY, ownerId);
      else localStorage.removeItem(ACTIVE_KEY);
    }catch(e){}
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

  // Returns the saved data for a section of the open plan (or null).
  // opts.legacyKey: an older localStorage key to migrate from (owner only).
  // opts.legacyMap: converts the legacy value into the new shape.
  async function load(section, opts){
    opts = opts || {};
    const c = client();
    const p = await plan();
    const legacy = (opts.legacyKey && (!p || p.isOwn)) ? readLocal(opts.legacyKey) : null;
    const legacyData = legacy == null ? null : (opts.legacyMap ? opts.legacyMap(legacy) : legacy);

    if(!c) return readLocal(LOCAL_PREFIX + section) || legacyData;
    if(!p) return null;

    const {data, error} = await c
      .from('plan_data')
      .select('data')
      .eq('user_id', p.ownerId)
      .eq('section', section)
      .maybeSingle();

    if(error){
      console.warn('Could not load', section, error.message);
      failed = true;
      status('Couldn’t load your saved information. Check your connection and reload.', 'error');
      return null;
    }
    if(data){
      if(opts.legacyKey && p.isOwn) removeLocal(opts.legacyKey);
      return data.data;
    }
    if(legacyData && p.isOwn){
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
    const p = await plan();
    if(!p || !p.canEdit) return false;
    status('Saving…', 'saving');
    const {error} = await c.from('plan_data').upsert({
      user_id: p.ownerId,
      section,
      data,
      updated_at: new Date().toISOString()
    }, {onConflict: 'user_id,section'});
    if(error){
      console.warn('Could not save', section, error.message);
      status(/row-level security/i.test(error.message)
        ? 'Not saved: this is over the Free plan’s limit or you don’t have edit access.'
        : 'Not saved. Check your connection; we’ll try again on your next change.', 'error');
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
      fields.forEach(f=>{ saved[f.dataset.key] = f.value; });
      save(section, saved);
    });
    return saved;
  }

  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Sidebar: parent's name, plan switcher, and view-only mode.
  async function setupPlanUi(){
    if(!document.body.dataset.authRequired) return;
    const p = await plan();
    if(!p) return;
    const profile = await load('profile');
    const name = (profile && profile.parentName && profile.parentName.trim()) || 'Parent / Loved One';
    document.querySelectorAll('.app-topbar .context[data-parent-name]').forEach(el=>{ el.textContent = name; });

    const box = document.querySelector('.app-profile');
    if(box){
      if(p.shared && p.shared.length){
        const opts = [`<option value="">My plan</option>`].concat(p.shared.map(s=>
          `<option value="${esc(s.owner_id)}">${esc(s.parent_name || 'Shared plan')} · ${esc(s.owner_email)}</option>`));
        box.innerHTML = `<label class="small" for="planSwitch">CURRENT PLAN</label>
          <select id="planSwitch" class="plan-switch">${opts.join('')}</select>
          <b class="plan-name">${esc(name)}</b>`;
        const sel = box.querySelector('#planSwitch');
        sel.value = p.isOwn ? '' : p.ownerId;
        sel.addEventListener('change', async ()=>{
          await flushAll();
          setActivePlan(sel.value || null);
          location.reload();
        });
      }else{
        const b = box.querySelector('b');
        if(b) b.textContent = name;
      }
    }

    if(document.body.dataset.accountPage) return; // account page always manages your own account
    if(!p.isOwn){
      const content = document.querySelector('.app-content');
      if(content){
        const note = document.createElement('div');
        note.className = 'notice shared-note';
        note.innerHTML = `<b>${p.canEdit ? 'Shared plan.' : 'View only.'}</b> ${esc(p.ownerEmail)} shared this plan with you` +
          (p.canEdit ? '; your changes are saved to their plan.' : '. Ask them for edit access to make changes.');
        content.prepend(note);
      }
      // The vault is personal and never shared.
      document.querySelectorAll('[data-vault-nav]').forEach(a=>a.title = 'Your own Password Vault (not shared)');
    }
    if(!p.canEdit) makeReadOnly();
  }

  function makeReadOnly(){
    document.body.classList.add('read-only');
    const content = document.querySelector('.app-content');
    if(!content) return;
    const lock = ()=>content.querySelectorAll('input, textarea, select, button').forEach(el=>{
      if(el.closest('[data-viewer-ok]') || el.dataset.action === 'toggle' || el.dataset.action === 'open' || el.closest('#docFilters')) return;
      el.disabled = true;
    });
    lock();
    new MutationObserver(lock).observe(content, {childList:true, subtree:true});
    document.querySelectorAll('.quick-action').forEach(a=>a.hidden = true);
  }

  window.yppStore = {load, save, saveNow, flushAll, bindFields, plan, setActivePlan};
  document.addEventListener('DOMContentLoaded', setupPlanUi);
})();
