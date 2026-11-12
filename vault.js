(function(){
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const ITERATIONS = 250000;
  const VERIFY_TEXT = 'YPP_VAULT_OK_v1';

  let client = null;
  let user = null;
  let key = null;
  let membership = null;

  function qs(id){ return document.getElementById(id); }
  function msg(text, type=''){
    const el = qs('vaultMessage');
    if(!el) return;
    el.textContent = text;
    el.className = 'auth-message show ' + type;
  }
  function b64(bytes){
    let s='';
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for(let i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str){
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for(let i=0;i<s.length;i++) out[i] = s.charCodeAt(i);
    return out;
  }
  async function deriveKey(passphrase, salt){
    const material = await crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      {name:'PBKDF2', salt, iterations:ITERATIONS, hash:'SHA-256'},
      material,
      {name:'AES-GCM', length:256},
      false,
      ['encrypt','decrypt']
    );
  }
  async function encryptText(plain, cryptoKey){
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      {name:'AES-GCM', iv},
      cryptoKey,
      enc.encode(plain)
    );
    return {ciphertext:b64(cipher), iv:b64(iv)};
  }
  async function decryptText(ciphertext, iv, cryptoKey){
    const plain = await crypto.subtle.decrypt(
      {name:'AES-GCM', iv:unb64(iv)},
      cryptoKey,
      unb64(ciphertext)
    );
    return dec.decode(plain);
  }

  async function init(){
    client = window.yppAuthClient;
    if(!client){
      window.location.href = 'login.html';
      return;
    }

    const {data, error} = await client.auth.getUser();
    if(error || !data?.user){
      window.location.href = 'login.html';
      return;
    }
    user = data.user;

    membership = window.yppGetMembership
      ? await window.yppGetMembership()
      : {isPlus:false};

    if(!membership.isPlus){
      qs('vaultLocked').hidden = false;
      qs('vaultSetup').hidden = true;
      qs('vaultUnlock').hidden = true;
      qs('vaultApp').hidden = true;
      return;
    }

    const {data: settings, error: settingsError} = await client
      .from('vault_settings')
      .select('salt,verifier_ciphertext,verifier_iv')
      .eq('user_id', user.id)
      .maybeSingle();

    if(settingsError){
      msg('The vault could not load yet. Make sure the Supabase vault setup SQL has been run.', 'error');
      return;
    }

    if(!settings){
      qs('vaultSetup').hidden = false;
      qs('vaultLocked').hidden = true;
      qs('vaultUnlock').hidden = true;
      qs('vaultApp').hidden = true;
    }else{
      qs('vaultSetup').hidden = true;
      qs('vaultLocked').hidden = true;
      qs('vaultUnlock').hidden = false;
      qs('vaultApp').hidden = true;
    }
  }

  async function createVault(){
    const pass = qs('newVaultPassphrase').value;
    const confirm = qs('confirmVaultPassphrase').value;
    if(pass.length < 12){
      msg('Use a vault passphrase with at least 12 characters.', 'error');
      return;
    }
    if(pass !== confirm){
      msg('The vault passphrases do not match.', 'error');
      return;
    }

    try{
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const newKey = await deriveKey(pass, salt);
      const verifier = await encryptText(VERIFY_TEXT, newKey);

      const {error} = await client.from('vault_settings').insert({
        user_id:user.id,
        salt:b64(salt),
        verifier_ciphertext:verifier.ciphertext,
        verifier_iv:verifier.iv
      });
      if(error) throw error;

      key = newKey;
      qs('vaultSetup').hidden = true;
      qs('vaultApp').hidden = false;
      msg('Password Vault created and unlocked.', 'success');
      await loadItems();
    }catch(err){
      msg(err.message || 'Could not create the vault.', 'error');
    }
  }

  async function unlockVault(){
    const pass = qs('vaultPassphrase').value;
    if(!pass){
      msg('Enter your vault passphrase.', 'error');
      return;
    }

    try{
      const {data: settings, error} = await client
        .from('vault_settings')
        .select('salt,verifier_ciphertext,verifier_iv')
        .eq('user_id', user.id)
        .single();
      if(error) throw error;

      const candidate = await deriveKey(pass, unb64(settings.salt));
      const check = await decryptText(
        settings.verifier_ciphertext,
        settings.verifier_iv,
        candidate
      );
      if(check !== VERIFY_TEXT) throw new Error('Incorrect vault passphrase.');

      key = candidate;
      qs('vaultUnlock').hidden = true;
      qs('vaultApp').hidden = false;
      msg('Vault unlocked.', 'success');
      await loadItems();
    }catch(err){
      msg(err.name === 'OperationError' ? 'Incorrect vault passphrase.' : (err.message || 'Could not unlock the vault.'), 'error');
    }
  }

  async function loadItems(){
    if(!key) return;
    const {data, error} = await client
      .from('vault_items')
      .select('id,ciphertext,iv,created_at,updated_at')
      .eq('user_id', user.id)
      .order('updated_at', {ascending:false});

    if(error){
      msg(error.message, 'error');
      return;
    }

    const decrypted = [];
    for(const row of (data || [])){
      try{
        const json = await decryptText(row.ciphertext, row.iv, key);
        decrypted.push({id:row.id, ...JSON.parse(json)});
      }catch(e){
        decrypted.push({id:row.id, account:'Unable to decrypt', category:'', website:'', username:'', password:'', notes:''});
      }
    }
    renderItems(decrypted);
  }

  function renderItems(items){
    const list = qs('vaultList');
    if(!items.length){
      list.innerHTML = '<div class="empty-state"><h3>No passwords saved yet</h3><p class="small">Add the first digital account your family may need.</p></div>';
      return;
    }
    list.innerHTML = items.map(item=>`
      <article class="vault-entry" data-id="${item.id}">
        <div class="vault-entry-main">
          <div>
            <span class="vault-category">${escapeHtml(item.category || 'Account')}</span>
            <h3>${escapeHtml(item.account || 'Untitled account')}</h3>
            <p class="small">${escapeHtml(item.website || '')}</p>
          </div>
          <div class="vault-entry-actions">
            <button class="icon-btn" data-action="edit">Edit</button>
            <button class="icon-btn" data-action="delete">Delete</button>
          </div>
        </div>
        <div class="vault-entry-grid">
          <div><span class="small">Username / email</span><b>${escapeHtml(item.username || '—')}</b></div>
          <div>
            <span class="small">Password</span>
            <div class="password-line"><code data-password>${escapeHtml(item.password || '')}</code>
            <button class="icon-btn" data-action="toggle-password">Show</button>
            <button class="icon-btn" data-action="copy-password">Copy</button></div>
          </div>
        </div>
        ${item.notes ? `<div class="vault-notes"><span class="small">Notes</span><p>${escapeHtml(item.notes)}</p></div>` : ''}
        <script type="application/json" class="vault-data">${escapeScriptJson(item)}</script>
      </article>
    `).join('');
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, c=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function escapeScriptJson(obj){
    return JSON.stringify(obj).replace(/</g,'\\u003c');
  }

  function openForm(item=null){
    qs('vaultFormTitle').textContent = item ? 'Edit account' : 'Add digital account';
    qs('vaultItemId').value = item?.id || '';
    qs('accountName').value = item?.account || '';
    qs('accountCategory').value = item?.category || 'Email';
    qs('accountWebsite').value = item?.website || '';
    qs('accountUsername').value = item?.username || '';
    qs('accountPassword').value = item?.password || '';
    qs('accountNotes').value = item?.notes || '';
    qs('vaultFormWrap').hidden = false;
    qs('accountName').focus();
  }

  async function saveItem(){
    if(!key){
      msg('Unlock the vault first.', 'error');
      return;
    }
    const payload = {
      account:qs('accountName').value.trim(),
      category:qs('accountCategory').value,
      website:qs('accountWebsite').value.trim(),
      username:qs('accountUsername').value.trim(),
      password:qs('accountPassword').value,
      notes:qs('accountNotes').value.trim()
    };
    if(!payload.account || !payload.password){
      msg('Add an account name and password.', 'error');
      return;
    }

    try{
      const encrypted = await encryptText(JSON.stringify(payload), key);
      const id = qs('vaultItemId').value;
      let result;
      if(id){
        result = await client.from('vault_items')
          .update({ciphertext:encrypted.ciphertext, iv:encrypted.iv, updated_at:new Date().toISOString()})
          .eq('id', id)
          .eq('user_id', user.id);
      }else{
        result = await client.from('vault_items')
          .insert({user_id:user.id, ciphertext:encrypted.ciphertext, iv:encrypted.iv});
      }
      if(result.error) throw result.error;

      qs('vaultFormWrap').hidden = true;
      msg('Saved securely.', 'success');
      await loadItems();
    }catch(err){
      msg(err.message || 'Could not save the password.', 'error');
    }
  }

  async function deleteItem(id){
    if(!confirm('Delete this password entry?')) return;
    const {error} = await client.from('vault_items')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
    if(error){
      msg(error.message, 'error');
      return;
    }
    await loadItems();
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    qs('createVaultBtn')?.addEventListener('click', createVault);
    qs('unlockVaultBtn')?.addEventListener('click', unlockVault);
    qs('addVaultItemBtn')?.addEventListener('click', ()=>openForm());
    qs('cancelVaultItemBtn')?.addEventListener('click', ()=>qs('vaultFormWrap').hidden = true);
    qs('saveVaultItemBtn')?.addEventListener('click', saveItem);
    qs('lockVaultBtn')?.addEventListener('click', ()=>{
      key = null;
      qs('vaultApp').hidden = true;
      qs('vaultUnlock').hidden = false;
      qs('vaultPassphrase').value = '';
      msg('Vault locked.', 'success');
    });

    qs('vaultList')?.addEventListener('click', e=>{
      const entry = e.target.closest('.vault-entry');
      if(!entry) return;
      const id = entry.dataset.id;
      const action = e.target.dataset.action;
      const dataEl = entry.querySelector('.vault-data');
      const item = dataEl ? JSON.parse(dataEl.textContent) : null;

      if(action === 'edit') openForm(item);
      if(action === 'delete') deleteItem(id);
      if(action === 'toggle-password'){
        const code = entry.querySelector('[data-password]');
        const hidden = code.dataset.hidden !== 'false';
        if(hidden){
          code.textContent = item?.password || '';
          code.dataset.hidden = 'false';
          e.target.textContent = 'Hide';
        }else{
          code.textContent = '••••••••••••';
          code.dataset.hidden = 'true';
          e.target.textContent = 'Show';
        }
      }
      if(action === 'copy-password'){
        navigator.clipboard.writeText(item?.password || '');
        msg('Password copied.', 'success');
      }
    });

    init();
  });
})();
