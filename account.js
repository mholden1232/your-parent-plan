// Account & family: sharing your plan, membership, email/password, delete account.
(function(){
  const $ = id => document.getElementById(id);
  let client = null, user = null;

  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function msg(text, type){
    const el = $('accountMessage');
    el.textContent = text || '';
    el.className = 'auth-message' + (text ? ' show ' + (type || '') : '');
    if(text) el.scrollIntoView({block:'nearest', behavior:'smooth'});
  }
  function friendly(err){
    const m = (err && err.message) || '';
    if(/row-level security/i.test(m)) return 'You don’t have permission to do that.';
    return m || 'Something went wrong. Please try again.';
  }
  const roleLabel = r => r === 'viewer' ? 'View only' : 'Can edit';

  // ---------- Family sharing (your own plan) ----------
  async function loadMembers(){
    const {data, error} = await client.from('plan_members')
      .select('member_id,member_email,role,created_at').eq('owner_id', user.id).order('created_at');
    if(error){ $('memberList').innerHTML = '<p class="small">Sharing isn’t set up yet (run supabase-family-setup.sql).</p>'; return; }
    $('memberList').innerHTML = data.length ? data.map(m=>`
      <div class="member" data-id="${esc(m.member_id)}">
        <div><b>${esc(m.member_email)}</b></div>
        <div class="member-actions">
          <select aria-label="Access for ${esc(m.member_email)}" data-action="role">
            <option value="editor"${m.role==='editor'?' selected':''}>Can edit</option>
            <option value="viewer"${m.role==='viewer'?' selected':''}>View only</option>
          </select>
          <button class="icon-btn" data-action="remove" type="button">Remove</button>
        </div>
      </div>`).join('') : '<p class="small">Only you, so far.</p>';
  }

  async function loadInvites(){
    const {data, error} = await client.from('plan_invites')
      .select('id,email,role,token,expires_at,accepted_at').eq('owner_id', user.id).is('accepted_at', null).order('created_at');
    if(error){ $('inviteList').innerHTML = ''; return; }
    const open = data.filter(i=>new Date(i.expires_at) > new Date());
    $('inviteList').innerHTML = open.length ? open.map(i=>`
      <div class="member" data-invite="${esc(i.id)}" data-token="${esc(i.token)}" data-email="${esc(i.email)}">
        <div><b>${esc(i.email)}</b><p class="small">${roleLabel(i.role)} · link expires ${new Date(i.expires_at).toLocaleDateString()}</p></div>
        <div class="member-actions">
          <button class="icon-btn" data-action="copy" type="button">Copy link</button>
          <button class="icon-btn" data-action="cancel" type="button">Cancel</button>
        </div>
      </div>`).join('') : '<p class="small">No open invitations.</p>';
  }

  function inviteUrl(token){
    return new URL('accept-invite.html?token=' + encodeURIComponent(token), location.href).href;
  }
  function showLink(email, token){
    const url = inviteUrl(token);
    $('inviteLinkBox').hidden = false;
    $('inviteLinkEmail').textContent = email;
    $('inviteLink').value = url;
    const subject = 'Join our family plan for Mom/Dad';
    const body = `I’m organizing our parent’s documents, money and care decisions in Your Parent Plan. Here’s your invitation (it works with this email address):\n\n${url}`;
    $('emailInvite').href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  async function copy(text, btn){
    try{ await navigator.clipboard.writeText(text); const t = btn.textContent; btn.textContent = 'Copied'; setTimeout(()=>btn.textContent = t, 1500); }
    catch(e){ $('inviteLink').select(); }
  }

  async function createInvite(e){
    e.preventDefault();
    const email = $('inviteEmail').value.trim().toLowerCase();
    if(!email) return;
    if(email === (user.email || '').toLowerCase()){ msg('That’s your own email. Invite someone else.', 'error'); return; }
    const {data, error} = await client.from('plan_invites')
      .insert({owner_id: user.id, email, role: $('inviteRole').value}).select('token').single();
    if(error){ msg(/row-level security/i.test(error.message) ? 'Sharing is part of Plus. Upgrade to invite family.' : friendly(error), 'error'); return; }
    $('inviteForm').reset();
    showLink(email, data.token);
    msg('');
    loadInvites();
  }

  async function onMemberList(e){
    const row = e.target.closest('.member');
    const act = e.target.dataset.action;
    if(!row || !act) return;
    if(row.dataset.id && act === 'remove'){
      if(!confirm('Remove their access to your plan?')) return;
      const {error} = await client.from('plan_members').delete().eq('owner_id', user.id).eq('member_id', row.dataset.id);
      if(error) return msg(friendly(error), 'error');
      loadMembers();
    }
    if(row.dataset.invite && act === 'cancel'){
      const {error} = await client.from('plan_invites').delete().eq('id', row.dataset.invite);
      if(error) return msg(friendly(error), 'error');
      loadInvites();
    }
    if(row.dataset.invite && act === 'copy'){
      showLink(row.dataset.email, row.dataset.token);
      copy(inviteUrl(row.dataset.token), e.target);
    }
  }
  async function onRoleChange(e){
    if(e.target.dataset.action !== 'role') return;
    const row = e.target.closest('.member');
    const {error} = await client.from('plan_members').update({role: e.target.value}).eq('owner_id', user.id).eq('member_id', row.dataset.id);
    msg(error ? friendly(error) : 'Access updated.', error ? 'error' : 'success');
  }

  async function loadShared(){
    const p = await window.yppStore.plan();
    const shared = (p && p.shared) || [];
    if(!shared.length) return;
    $('sharedWithMe').hidden = false;
    $('sharedList').innerHTML = shared.map(s=>`
      <div class="member" data-owner="${esc(s.owner_id)}">
        <div><b>${esc(s.parent_name || 'Shared plan')}</b><p class="small">From ${esc(s.owner_email)} · ${roleLabel(s.role)}</p></div>
        <div class="member-actions">
          <button class="icon-btn" data-action="open" type="button">Open</button>
          <button class="icon-btn" data-action="leave" type="button">Leave</button>
        </div>
      </div>`).join('');
  }
  async function onShared(e){
    const row = e.target.closest('[data-owner]');
    const act = e.target.dataset.action;
    if(!row || !act) return;
    if(act === 'open'){ window.yppStore.setActivePlan(row.dataset.owner); location.href = 'plan.html'; }
    if(act === 'leave'){
      if(!confirm('Leave this plan? You’ll need a new invitation to get back in.')) return;
      const {error} = await client.from('plan_members').delete().eq('owner_id', row.dataset.owner).eq('member_id', user.id);
      if(error) return msg(friendly(error), 'error');
      window.yppStore.setActivePlan(null);
      row.remove();
      msg('You’ve left that plan.', 'success');
    }
  }

  // ---------- Membership ----------
  async function loadMembership(){
    const {data} = await client.from('memberships')
      .select('tier,status,current_period_end,cancel_at_period_end,stripe_customer_id').eq('user_id', user.id).maybeSingle();
    const plus = data && data.status === 'active' && (data.tier === 'plus_monthly' || data.tier === 'plus_annual');
    $('familyLocked').hidden = plus;
    $('inviteForm').hidden = !plus;
    if(!plus){
      if(data && data.stripe_customer_id){
        $('memberCta').textContent = 'Manage billing';
        $('memberCta').setAttribute('data-manage-billing', '');
      }
      return;
    }
    $('memberTier').textContent = data.tier === 'plus_annual' ? 'Plus Annual' : 'Plus Monthly';
    const end = data.current_period_end ? new Date(data.current_period_end).toLocaleDateString() : null;
    $('memberDetail').textContent = data.cancel_at_period_end
      ? `Canceled. Plus stays on until ${end || 'the end of the paid period'}, then switches to Free.`
      : end ? `Renews on ${end}.` : 'Plus is active.';
    const cta = $('memberCta');
    if(data.stripe_customer_id){ cta.textContent = 'Manage billing'; cta.setAttribute('data-manage-billing', ''); }
    else { cta.hidden = true; }
  }
  async function manageBilling(e){
    const b = e.target.closest('[data-manage-billing]');
    if(!b) return;
    e.preventDefault();
    b.textContent = 'One moment…';
    const {data, error} = await client.functions.invoke('billing-portal', {body:{}});
    if(error || !data || !data.url){ msg('Billing couldn’t open. Please try again in a moment.', 'error'); b.textContent = 'Manage billing'; return; }
    location.href = data.url;
  }

  // ---------- Email / password / delete ----------
  async function changeEmail(e){
    e.preventDefault();
    const email = $('newEmail').value.trim();
    const {error} = await client.auth.updateUser({email}, {emailRedirectTo: new URL('account.html', location.href).href});
    if(error) return msg(friendly(error), 'error');
    $('emailForm').reset();
    msg('Check both your old and new email for a confirmation link. The change happens once it’s confirmed.', 'success');
  }
  async function changePassword(e){
    e.preventDefault();
    const a = $('newPassword').value, b = $('newPassword2').value;
    if(a.length < 8) return msg('Use at least 8 characters.', 'error');
    if(a !== b) return msg('The passwords don’t match.', 'error');
    const {error} = await client.auth.updateUser({password: a});
    if(error) return msg(friendly(error), 'error');
    $('passwordForm').reset();
    msg('Password changed.', 'success');
  }
  async function deleteAccount(){
    if($('deleteConfirm').value.trim() !== 'DELETE') return;
    if(!confirm('Delete your account and everything in it? This can’t be undone.')) return;
    $('deleteBtn').disabled = true;
    $('deleteBtn').textContent = 'Deleting…';
    const {data, error} = await client.functions.invoke('delete-account', {body:{confirm:'DELETE'}});
    if(error || !data || !data.deleted){
      $('deleteBtn').disabled = false;
      $('deleteBtn').textContent = 'Delete my account';
      return msg('Your account couldn’t be deleted just now. Please try again in a moment.', 'error');
    }
    try{ localStorage.clear(); }catch(e){}
    await client.auth.signOut();
    location.href = 'index.html';
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    if(!$('familySection')) return;
    client = window.yppAuthClient;
    if(!client){ msg('Your account can’t be reached right now. Please reload or try again later.', 'error'); return; }
    const {data} = await client.auth.getUser();
    if(!data || !data.user) return; // auth.js sends the visitor to log in
    user = data.user;
    $('accountEmail').textContent = user.email || '';

    $('inviteForm').addEventListener('submit', createInvite);
    $('copyInvite').addEventListener('click', e=>copy($('inviteLink').value, e.target));
    $('memberList').addEventListener('click', onMemberList);
    $('memberList').addEventListener('change', onRoleChange);
    $('inviteList').addEventListener('click', onMemberList);
    $('sharedList').addEventListener('click', onShared);
    $('emailForm').addEventListener('submit', changeEmail);
    $('passwordForm').addEventListener('submit', changePassword);
    $('deleteConfirm').addEventListener('input', ()=>{ $('deleteBtn').disabled = $('deleteConfirm').value.trim() !== 'DELETE'; });
    $('deleteBtn').addEventListener('click', deleteAccount);
    document.addEventListener('click', manageBilling);

    await Promise.all([loadMembership(), loadMembers(), loadInvites(), loadShared()]);
  });
})();
