// Billing: starts Stripe Checkout from the pricing page and opens the
// billing portal for Plus members. Server side lives in supabase/functions.
(function(){
  const PLANS = ['plus_monthly','plus_annual'];

  function client(){ return window.yppAuthClient || null; }

  function note(text, type){
    const el = document.getElementById('billingMessage');
    if(!el) return;
    el.textContent = text || '';
    el.className = 'auth-message' + (text ? ' show ' + (type || '') : '');
    if(text) el.scrollIntoView({block:'nearest', behavior:'smooth'});
  }

  async function session(){
    const c = client();
    if(!c) return null;
    const {data} = await c.auth.getSession();
    return data && data.session;
  }

  async function call(fn, body, button){
    const c = client();
    const label = button ? button.textContent : '';
    if(button){ button.disabled = true; button.textContent = 'One moment…'; }
    try{
      const {data, error} = await c.functions.invoke(fn, {body: body || {}});
      if(error){
        let message = 'That didn’t work. Please try again in a moment.';
        try{ const j = await error.context.json(); if(j && j.error) message = j.error; }catch(e){}
        throw new Error(message);
      }
      if(!data || !data.url) throw new Error('That didn’t work. Please try again in a moment.');
      window.location.href = data.url;
    }catch(err){
      note(err.message, 'error');
      if(button){ button.disabled = false; button.textContent = label; }
    }
  }

  async function startCheckout(plan, button){
    if(!PLANS.includes(plan)) return;
    if(!client()){ note('Checkout isn’t available right now. Please reload and try again.', 'error'); return; }
    if(!(await session())){
      window.location.href = 'signup.html?plan=' + encodeURIComponent(plan);
      return;
    }
    await call('create-checkout', {plan}, button);
  }

  async function setupPricing(){
    const buttons = document.querySelectorAll('[data-plan]');
    if(!buttons.length) return;

    buttons.forEach(b=>b.addEventListener('click', e=>{
      e.preventDefault();
      startCheckout(b.dataset.plan, b);
    }));
    document.querySelectorAll('[data-manage-billing]').forEach(b=>b.addEventListener('click', e=>{
      e.preventDefault();
      call('billing-portal', {}, b);
    }));

    const params = new URLSearchParams(location.search);
    if(params.get('checkout') === 'canceled') note('Checkout was canceled. You haven’t been charged.', '');

    if(!(await session())) return;
    const m = window.yppGetMembership ? await window.yppGetMembership() : {isPlus:false};
    if(m.isPlus){
      const label = m.tier === 'plus_annual' ? 'Plus Annual' : 'Plus Monthly';
      document.querySelectorAll('[data-plus-status]').forEach(el=>{
        el.hidden = false;
        const t = el.querySelector('[data-plus-tier]');
        if(t) t.textContent = label;
      });
      buttons.forEach(b=>{
        b.textContent = b.dataset.plan === m.tier ? 'Your current plan' : 'Switch in Manage billing';
        b.classList.remove('primary'); b.classList.add('secondary');
        b.replaceWith(b.cloneNode(true)); // drop the checkout handler
      });
      document.querySelectorAll('[data-plan]').forEach(b=>b.addEventListener('click', e=>{
        e.preventDefault();
        call('billing-portal', {}, b);
      }));
      return;
    }
    // Arrived here from sign-up / log-in after choosing a plan.
    const wanted = params.get('checkout');
    if(PLANS.includes(wanted)){
      history.replaceState(null, '', 'pricing.html');
      note('Taking you to secure checkout…', 'success');
      startCheckout(wanted, document.querySelector('[data-plan="' + wanted + '"]'));
    }
  }

  // After a successful checkout Stripe returns to plan.html?upgraded=1.
  // The webhook can take a few seconds, so check a few times.
  async function welcomeBack(){
    const params = new URLSearchParams(location.search);
    if(params.get('upgraded') !== '1') return;
    history.replaceState(null, '', location.pathname);
    const content = document.querySelector('.app-content');
    if(!content) return;
    const box = document.createElement('div');
    box.className = 'good';
    box.setAttribute('role', 'status');
    box.innerHTML = '<b>Thank you!</b> Finishing your Plus upgrade…';
    content.prepend(box);
    for(let i = 0; i < 8; i++){
      const m = window.yppGetMembership ? await window.yppGetMembership() : {isPlus:false};
      if(m.isPlus){
        box.innerHTML = '<b>Welcome to Plus.</b> The Password Vault, unlimited uploads and the rest of Plus are now unlocked.';
        document.querySelectorAll('.nav-plus-badge').forEach(b=>b.classList.remove('locked'));
        return;
      }
      await new Promise(r=>setTimeout(r, 2500));
    }
    box.innerHTML = '<b>Payment received.</b> Your Plus access is still being switched on. Reload this page in a minute or two.';
  }

  document.addEventListener('DOMContentLoaded', ()=>{ setupPricing(); welcomeBack(); });
})();
