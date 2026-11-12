// Scan & Organize: upload documents to a private Supabase Storage bucket.
// Files: bucket "documents", path "<user id>/<random id>-<file name>".
// Details: table public.documents. See supabase-app-data-setup.sql.
(function(){
  const BUCKET = 'documents';
  const FREE_LIMIT = 10;
  const MAX_BYTES = 15 * 1024 * 1024;
  const $ = id => document.getElementById(id);
  let client = null, user = null, isPlus = false, docs = [], filter = 'All';

  function esc(s){
    return String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function msg(text, type){
    const el = $('docMessage');
    el.textContent = text || '';
    el.className = 'auth-message' + (text ? ' show ' + (type || '') : '');
  }
  function size(n){
    if(n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }
  function safeName(name){
    return name.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'file';
  }
  function setBusy(busy){
    $('uploadBtn').disabled = busy;
    $('uploadBtn').textContent = busy ? 'Uploading…' : 'Upload document';
  }

  function usage(){
    const el = $('docUsage');
    if(isPlus){ el.textContent = 'Plus: unlimited documents. Up to 15 MB each.'; return; }
    const left = Math.max(0, FREE_LIMIT - docs.length);
    el.innerHTML = `${docs.length} of ${FREE_LIMIT} free documents used. Up to 15 MB each.` +
      (left === 0 ? ' <a href="pricing.html">Upgrade to Plus</a> for unlimited uploads.' : '');
  }

  function render(){
    const cats = ['All', ...new Set(docs.map(d=>d.category))];
    if(!cats.includes(filter)) filter = 'All';
    $('docFilters').innerHTML = docs.length ? cats.map(c=>
      `<button type="button" data-filter="${esc(c)}" aria-pressed="${c === filter}">${esc(c)}</button>`).join('') : '';
    const shown = filter === 'All' ? docs : docs.filter(d=>d.category === filter);
    $('docList').innerHTML = shown.length ? shown.map(d=>`
      <article class="doc" data-id="${esc(d.id)}">
        <div>
          <span class="status">${esc(d.category)}</span>
          <div class="doc-name">${esc(d.name)}</div>
          <p class="small">${new Date(d.created_at).toLocaleDateString()} · ${size(d.size_bytes)}${d.note ? ' · ' + esc(d.note) : ''}</p>
        </div>
        <div class="doc-actions">
          <button class="icon-btn" data-action="open" type="button">Open</button>
          <button class="icon-btn" data-action="delete" type="button">Delete</button>
        </div>
      </article>`).join('')
      : '<div class="empty-state"><h3>No documents yet</h3><p class="small">Start with the power of attorney or an insurance card.</p></div>';
    usage();
  }

  async function loadDocs(){
    const {data, error} = await client.from('documents')
      .select('id,name,category,note,storage_path,mime_type,size_bytes,created_at')
      .eq('user_id', user.id)
      .order('created_at', {ascending:false});
    if(error){
      $('docList').innerHTML = '';
      msg('Your documents couldn’t load. Make sure supabase-app-data-setup.sql has been run, then reload.', 'error');
      return;
    }
    docs = data || [];
    render();
  }

  async function upload(e){
    e.preventDefault();
    msg('');
    const file = $('docFile').files[0];
    if(!file){ msg('Choose a photo or file first.', 'error'); return; }
    if(file.size > MAX_BYTES){ msg('That file is larger than 15 MB. Try a smaller photo or a PDF.', 'error'); return; }
    if(!isPlus && docs.length >= FREE_LIMIT){
      msg('Free accounts can keep up to 10 documents. Upgrade to Plus for unlimited uploads, or delete one first.', 'error');
      return;
    }
    const name = $('docName').value.trim() || file.name.replace(/\.[^.]+$/, '');
    const path = `${user.id}/${crypto.randomUUID()}-${safeName(file.name)}`;
    setBusy(true);
    try{
      // Record first: the database enforces the free-plan limit.
      const {data: row, error: rowErr} = await client.from('documents').insert({
        user_id: user.id, name, category: $('docCategory').value, note: $('docNote').value.trim(),
        storage_path: path, mime_type: file.type || '', size_bytes: file.size
      }).select().single();
      if(rowErr){
        throw new Error(/row-level security/i.test(rowErr.message)
          ? 'Free accounts can keep up to 10 documents. Upgrade to Plus for unlimited uploads.'
          : rowErr.message);
      }
      const {error: upErr} = await client.storage.from(BUCKET).upload(path, file, {contentType: file.type || undefined, upsert:false});
      if(upErr){
        await client.from('documents').delete().eq('id', row.id);
        throw new Error(/mime|type/i.test(upErr.message)
          ? 'That file type isn’t supported. Use a photo, PDF or Word document.'
          : upErr.message);
      }
      docs.unshift(row);
      $('uploadForm').reset();
      render();
      msg('Uploaded “' + name + '”.', 'success');
    }catch(err){
      msg(err.message || 'The upload didn’t work. Please try again.', 'error');
    }finally{
      setBusy(false);
    }
  }

  async function onListClick(e){
    const btn = e.target.closest('[data-action]');
    const card = e.target.closest('.doc');
    if(!btn || !card) return;
    const d = docs.find(x=>x.id === card.dataset.id);
    if(!d) return;
    if(btn.dataset.action === 'open'){
      // Open a tab right away (pop-up blockers allow it during the click), then point it at the file.
      const win = window.open('', '_blank');
      const {data, error} = await client.storage.from(BUCKET).createSignedUrl(d.storage_path, 120);
      if(error || !data){ if(win) win.close(); msg('That document couldn’t be opened. Please try again.', 'error'); return; }
      if(win){ win.opener = null; win.location.href = data.signedUrl; } else { window.location.href = data.signedUrl; }
    }
    if(btn.dataset.action === 'delete'){
      if(!confirm('Delete “' + d.name + '”? This can’t be undone.')) return;
      const {error: stErr} = await client.storage.from(BUCKET).remove([d.storage_path]);
      if(stErr){ msg('That document couldn’t be deleted. Please try again.', 'error'); return; }
      await client.from('documents').delete().eq('id', d.id);
      docs = docs.filter(x=>x.id !== d.id);
      render();
      msg('Deleted.', 'success');
    }
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    if(!$('uploadForm')) return;
    $('docFilters').addEventListener('click', e=>{
      const b = e.target.closest('[data-filter]');
      if(b){ filter = b.dataset.filter; render(); }
    });
    $('docList').addEventListener('click', onListClick);
    $('uploadForm').addEventListener('submit', upload);

    client = window.yppAuthClient;
    if(!client){
      $('docList').innerHTML = '';
      $('uploadBtn').disabled = true;
      msg('Uploading needs your account connection, which isn’t available right now. Please reload or try again later.', 'error');
      return;
    }
    const {data} = await client.auth.getSession();
    if(!data || !data.session) return; // auth.js sends the visitor to log in
    user = data.session.user;
    const m = window.yppGetMembership ? await window.yppGetMembership() : {isPlus:false};
    isPlus = !!m.isPlus;
    await loadDocs();
  });
})();
