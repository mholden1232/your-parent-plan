
(function(){
  const configured =
    window.YPP_SUPABASE_URL &&
    window.YPP_SUPABASE_PUBLISHABLE_KEY &&
    !window.YPP_SUPABASE_URL.startsWith("YOUR_") &&
    !window.YPP_SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_");

  let client = null;
  if(configured && window.supabase){
    client = window.supabase.createClient(
      window.YPP_SUPABASE_URL,
      window.YPP_SUPABASE_PUBLISHABLE_KEY
    );
  }
  window.yppAuthClient = client;

  // Where to go after signing in: a chosen plan goes to checkout,
  // ?next=page.html returns to the page that asked for a login.
  const params=new URLSearchParams(window.location.search);
  const PLANS=['plus_monthly','plus_annual'];
  function destination(){
    const plan=params.get('plan');
    if(PLANS.includes(plan)) return 'pricing.html?checkout='+plan;
    const next=params.get('next')||'';
    if(/^[a-z0-9-]+\.html$/i.test(next)) return next;
    if(/^accept-invite\.html\?token=[a-f0-9]{16,128}$/i.test(next)) return next;
    return 'plan.html';
  }

  function msg(text,type){
    const el=document.getElementById('authMessage');
    if(!el)return;
    el.textContent=text;
    el.className='auth-message show '+(type||'');
  }

  async function signUp(){
    if(!client){msg('Account setup is not connected yet. Next step: connect Supabase.','error');return;}
    const email=(document.getElementById('email')||{}).value||'';
    const password=(document.getElementById('password')||{}).value||'';
    const confirm=(document.getElementById('confirmPassword')||{}).value||'';
    if(!email || password.length<8){msg('Enter an email and a password with at least 8 characters.','error');return;}
    if(password!==confirm){msg('Passwords do not match.','error');return;}
    const options={};
    if(/^https?:$/.test(window.location.protocol)){
      options.emailRedirectTo=new URL(destination(),window.location.href).href;
    }
    const {data,error}=await client.auth.signUp({email,password,options});
    if(error){msg(error.message,'error');return;}
    if(data.user && !data.session){
      msg('Account created. Check your email and click the link to confirm your address.','success');
    }else{
      window.location.href=destination();
    }
  }

  async function signIn(){
    if(!client){msg('Account setup is not connected yet. Next step: connect Supabase.','error');return;}
    const email=(document.getElementById('email')||{}).value||'';
    const password=(document.getElementById('password')||{}).value||'';
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){msg(error.message,'error');return;}
    window.location.href=destination();
  }

  async function signOut(){
    if(client) await client.auth.signOut();
    window.location.href='index.html';
  }

  async function guard(){
    if(!document.body.dataset.authRequired) return;
    // While Supabase is not connected, keep prototype reviewable.
    if(!client){
      const top=document.querySelector('.app-topbar');
      if(top){
        const notice=document.createElement('div');
        notice.className='small connection-note';
        notice.textContent='Can’t reach your account right now. Changes on this page are kept on this device only.';
        top.appendChild(notice);
      }
      return;
    }
    const {data}=await client.auth.getSession();
    if(!data.session){
      const page=(window.location.pathname.split('/').pop()||'plan.html');
      window.location.href='login.html?next='+encodeURIComponent(page);
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const su=document.getElementById('signUpBtn');
    const si=document.getElementById('signInBtn');
    if(su) su.addEventListener('click',signUp);
    if(si) si.addEventListener('click',signIn);
    document.querySelectorAll('[data-logout]').forEach(x=>x.addEventListener('click',signOut));
    // Keep ?plan= / ?next= when switching between log in and sign up.
    if(window.location.search){
      document.querySelectorAll('.auth-switch a').forEach(a=>{a.href=a.getAttribute('href').split('?')[0]+window.location.search;});
    }
    // Enter submits the form.
    document.querySelectorAll('.auth-card input').forEach(i=>i.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ (su||si) && (su||si).click(); }
    }));
    guard();
  });
})();
