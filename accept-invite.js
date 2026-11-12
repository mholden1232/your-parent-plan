// Accept a family invitation: accept-invite.html?token=...
(function(){
  const $ = id => document.getElementById(id);
  function msg(text, type){
    const el = $('authMessage');
    el.textContent = text;
    el.className = 'auth-message show ' + (type || '');
  }
  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  document.addEventListener('DOMContentLoaded', async ()=>{
    const client = window.yppAuthClient;
    const token = new URLSearchParams(location.search).get('token') || '';
    if(!/^[a-f0-9]{16,128}$/i.test(token)){ $('inviteText').textContent = ''; return msg('This invitation link isn’t complete. Ask for a new one.', 'error'); }
    if(!client){ $('inviteText').textContent = ''; return msg('Your account can’t be reached right now. Please try again later.', 'error'); }

    const {data: info, error} = await client.rpc('ypp_invite_info', {p_token: token});
    const inv = Array.isArray(info) ? info[0] : info;
    if(error || !inv){ $('inviteText').textContent = ''; return msg('This invitation link isn’t valid. Ask for a new one.', 'error'); }
    if(inv.accepted){ $('inviteText').textContent = ''; return msg('This invitation has already been used. If it was you, just log in.', 'error'); }
    if(inv.expired){ $('inviteText').textContent = ''; return msg('This invitation has expired. Ask for a new one.', 'error'); }

    $('inviteText').innerHTML = `<b>${esc(inv.owner_email)}</b> invited <b>${esc(inv.invited_email)}</b> to help with their parent’s plan (${inv.role === 'viewer' ? 'view only' : 'can edit'}).`;

    const {data: s} = await client.auth.getSession();
    const user = s && s.session && s.session.user;
    const next = 'accept-invite.html?token=' + token;
    if(!user){
      $('inviteAuth').hidden = false;
      $('inviteSignup').href = 'signup.html?next=' + encodeURIComponent(next);
      $('inviteLogin').href = 'login.html?next=' + encodeURIComponent(next);
      return;
    }
    if((user.email || '').toLowerCase() !== String(inv.invited_email).toLowerCase()){
      return msg(`You’re signed in as ${user.email}, but this invitation is for ${inv.invited_email}. Log out and sign in with that email to accept.`, 'error');
    }
    $('acceptBtn').hidden = false;
    $('acceptBtn').addEventListener('click', async ()=>{
      $('acceptBtn').disabled = true;
      const {data: ownerId, error: accErr} = await client.rpc('ypp_accept_invite', {p_token: token});
      if(accErr){ $('acceptBtn').disabled = false; return msg(accErr.message, 'error'); }
      try{ localStorage.setItem('ypp-active-plan', ownerId); }catch(e){}
      location.href = 'plan.html';
    });
  });
})();
