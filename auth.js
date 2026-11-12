
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
    const {data,error}=await client.auth.signUp({email,password});
    if(error){msg(error.message,'error');return;}
    if(data.user && !data.session){
      msg('Account created. Check your email to confirm your address, then sign in.','success');
    }else{
      window.location.href='plan.html';
    }
  }

  async function signIn(){
    if(!client){msg('Account setup is not connected yet. Next step: connect Supabase.','error');return;}
    const email=(document.getElementById('email')||{}).value||'';
    const password=(document.getElementById('password')||{}).value||'';
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){msg(error.message,'error');return;}
    window.location.href='plan.html';
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
        notice.className='small';
        notice.style.color='#8A4A23';
        notice.textContent='Prototype preview — account security not connected yet.';
        top.appendChild(notice);
      }
      return;
    }
    const {data}=await client.auth.getSession();
    if(!data.session){
      window.location.href='login.html';
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const su=document.getElementById('signUpBtn');
    const si=document.getElementById('signInBtn');
    if(su) su.addEventListener('click',signUp);
    if(si) si.addEventListener('click',signIn);
    document.querySelectorAll('[data-logout]').forEach(x=>x.addEventListener('click',signOut));
    guard();
  });
})();
