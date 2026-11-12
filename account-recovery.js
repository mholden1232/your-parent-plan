// Forgot password / choose a new password.
(function(){
  const $ = id => document.getElementById(id);
  function msg(text, type){
    const el = $('authMessage');
    el.textContent = text;
    el.className = 'auth-message show ' + (type || '');
  }
  document.addEventListener('DOMContentLoaded', ()=>{
    const client = window.yppAuthClient;

    const forgot = $('forgotForm');
    if(forgot) forgot.addEventListener('submit', async e=>{
      e.preventDefault();
      if(!client) return msg('Your account can’t be reached right now. Please try again later.', 'error');
      const btn = forgot.querySelector('button');
      btn.disabled = true;
      const {error} = await client.auth.resetPasswordForEmail($('email').value.trim(), {
        redirectTo: new URL('reset-password.html', location.href).href
      });
      btn.disabled = false;
      if(error) return msg(error.message, 'error');
      // Same message whether or not the email has an account.
      msg('If that email has an account, a reset link is on its way. Check your inbox (and spam).', 'success');
      forgot.reset();
    });

    const reset = $('resetForm');
    if(reset){
      if(!client){ msg('Your account can’t be reached right now. Please try again later.', 'error'); return; }
      // The link from the email signs the person in for this one purpose.
      let ready = false;
      client.auth.onAuthStateChange((event, session)=>{ if(session) ready = true; });
      client.auth.getSession().then(({data})=>{
        if(data && data.session) ready = true;
        setTimeout(()=>{ if(!ready) msg('This reset link has expired or was already used. Ask for a new one below.', 'error'); }, 1500);
      });
      reset.addEventListener('submit', async e=>{
        e.preventDefault();
        const a = $('password').value, b = $('confirmPassword').value;
        if(a.length < 8) return msg('Use at least 8 characters.', 'error');
        if(a !== b) return msg('The passwords don’t match.', 'error');
        const {error} = await client.auth.updateUser({password: a});
        if(error) return msg(error.message, 'error');
        msg('Password saved. Taking you to your plan…', 'success');
        setTimeout(()=>{ location.href = 'plan.html'; }, 1200);
      });
    }
  });
})();
